/**
 * DebugDNA — deterministic static signal extractor.
 *
 * Extracts which of the 7 canonical diagnostic signal names are declared
 * in a TypeScript/JavaScript source file by scanning:
 *   1. Structured logger call argument objects (logger.error({…}), logger.warn({…}), etc.)
 *   2. `throw new <ErrorType>(…)` statements for errorType inference.
 *
 * Rules:
 * - Only the 7 canonical names are ever returned.
 * - `timestamp` is explicitly excluded even if it appears in the source.
 * - Comment lines and non-logger string literals are ignored where possible.
 * - Extraction can be scoped to specific line ranges (e.g. the changed ranges
 *   returned by diff-scanner) so that unrelated branches do not contribute.
 * - No AST, no child processes, no network — pure regex over source text.
 */

import { CANONICAL_SIGNAL_NAMES, type DiagnosticSignal } from "./types";
import type { LineRange } from "./diff-scanner";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The canonical set, as a plain Set for O(1) lookup. */
const CANONICAL_SET = new Set<string>(CANONICAL_SIGNAL_NAMES);

/**
 * `timestamp` must NEVER appear as a signal even if found in the source.
 * This set is checked as an explicit block-list before any signal is emitted.
 */
const BLOCKED_NAMES = new Set(["timestamp"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip single-line comments (//) from a line (naively — sufficient for MVP). */
function stripLineComment(line: string): string {
  // Remove everything from the first // that is not inside a string literal.
  // Simple heuristic: find // that is not preceded by an odd number of quotes.
  const idx = line.indexOf("//");
  if (idx === -1) return line;
  // Count single and double quotes before idx — if even, it is a real comment.
  const before = line.slice(0, idx);
  const singleQuotes = (before.match(/'/g) ?? []).length;
  const doubleQuotes = (before.match(/"/g) ?? []).length;
  if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
    return line.slice(0, idx);
  }
  return line;
}

/**
 * Remove block-comment lines entirely.
 * A line is treated as a block-comment line if it starts (after whitespace)
 * with * or ends with * /  (inside /* … *\/ blocks).
 */
function removeBlockCommentLines(lines: string[]): string[] {
  const result: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!inBlock) {
      if (trimmed.startsWith("/*")) {
        inBlock = !trimmed.includes("*/");
        result.push(""); // blank out comment line
        continue;
      }
      result.push(line);
    } else {
      if (trimmed.includes("*/")) inBlock = false;
      result.push(""); // blank out comment line
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pattern: logger call blocks
// ---------------------------------------------------------------------------

/**
 * Matches the opening of a logger call:
 *   logger.error({ …
 *   logger.warn({ …
 *   logger.info({ …
 *   logger.debug({ …
 */
const LOGGER_CALL_START_RE = /\blogger\.(error|warn|info|debug)\s*\(\s*\{/;

/**
 * Matches a single object-key shorthand or key: value entry.
 *
 * We look for:
 *   - `signalName,`           shorthand property
 *   - `signalName: …,`        key–value property
 *   - `signalName}`           last property (no trailing comma)
 *   - `signalName: …}`        last key-value
 *
 * The pattern anchors on word boundaries so "paymentProviderX" is not matched
 * for "paymentProvider".
 */
const OBJECT_KEY_RE = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:[:,}])/g;

/**
 * Extract signal names from one logical logger call block (multi-line text
 * already merged into a single string).
 */
function extractSignalsFromLoggerBlock(
  block: string,
  fileRef: string,
  startLine: number,
  found: Map<string, DiagnosticSignal>
): void {
  // Find the object literal between the outer braces.
  const openBrace = block.indexOf("{");
  if (openBrace === -1) return;
  const closeBrace = block.lastIndexOf("}");
  // Include the closing brace so the final shorthand key (e.g. `orderId}`)
  // is matched by the `,|:|}`  terminator in OBJECT_KEY_RE.
  const inner = closeBrace > openBrace ? block.slice(openBrace + 1, closeBrace + 1) : block.slice(openBrace + 1);

  // Extract all identifier keys in the object.
  let m: RegExpExecArray | null;
  OBJECT_KEY_RE.lastIndex = 0;
  while ((m = OBJECT_KEY_RE.exec(inner)) !== null) {
    const key = m[1];
    if (BLOCKED_NAMES.has(key)) continue; // explicitly skip timestamp
    if (!CANONICAL_SET.has(key)) continue; // only canonical names
    if (found.has(key)) continue; // deduplicate

    found.set(key, {
      name: key,
      category: "log",
      location: `${fileRef}:${startLine}`,
      present: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Pattern: throw new <ErrorType>(…)
// ---------------------------------------------------------------------------

/**
 * Detect `throw new PaymentError(…)` or similar typed throws and emit
 * `errorType` as a signal when the throw uses a non-generic Error subclass.
 *
 * The changed version uses `throw new Error(…)` — generic, no diagnostic
 * value — so we deliberately do NOT emit errorType for that case.
 */
const TYPED_THROW_RE = /\bthrow\s+new\s+([A-Z][a-zA-Z0-9_]*Error)\s*\(/;

function extractSignalsFromThrow(
  line: string,
  fileRef: string,
  lineNumber: number,
  found: Map<string, DiagnosticSignal>
): void {
  const m = line.match(TYPED_THROW_RE);
  if (!m) return;
  const typeName = m[1];
  // Only emit errorType when a *domain-specific* error type is used (not the
  // bare built-in "Error" itself).
  if (typeName === "Error") return;

  if (!found.has("errorType")) {
    found.set("errorType", {
      name: "errorType",
      category: "error",
      location: `${fileRef}:${lineNumber}`,
      present: true,
      value: typeName,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  signals: DiagnosticSignal[];
  /** Names of canonical signals that were NOT found in this source. */
  missingSignals: string[];
}

// Re-export LineRange so callers can import it from one place.
export type { LineRange };

/**
 * Returns true when 1-based line number `ln` falls within at least one range.
 * When `ranges` is undefined or empty every line is considered in-range.
 */
function inRanges(ln: number, ranges: LineRange[] | undefined): boolean {
  if (!ranges || ranges.length === 0) return true;
  return ranges.some((r) => ln >= r.start && ln <= r.end);
}

/**
 * Core extraction worker.
 *
 * @param lines     Comment-stripped source lines (0-based array).
 * @param fileRef   Short label for `location` fields.
 * @param ranges    Optional 1-based line ranges to restrict scanning.
 *                  When omitted, the entire file is scanned.
 */
function runExtraction(
  lines: string[],
  fileRef: string,
  ranges: LineRange[] | undefined
): Map<string, DiagnosticSignal> {
  const found = new Map<string, DiagnosticSignal>();

  // -------------------------------------------------------------------------
  // Pass 1 — scan for logger call blocks (may span multiple lines).
  //
  // A logger call is included when its *opening line* falls within a range.
  // The block may span additional lines beyond the range boundary — that is
  // intentional: a multi-line logger.error({ … }) whose opening is inside the
  // changed range is scanned in full.
  // -------------------------------------------------------------------------
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const lineNumber = i + 1; // 1-based

    if (LOGGER_CALL_START_RE.test(line) && inRanges(lineNumber, ranges)) {
      // Accumulate lines until brace depth returns to 0.
      const blockLines: string[] = [];
      let depth = 0;
      let j = i;
      while (j < lines.length) {
        const l = lines[j];
        for (const ch of l) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
        blockLines.push(l);
        j++;
        if (depth <= 0 && blockLines.length > 0) break;
      }
      const block = blockLines.join("\n");
      extractSignalsFromLoggerBlock(block, fileRef, lineNumber, found);
      i = j;
      continue;
    }
    i++;
  }

  // -------------------------------------------------------------------------
  // Pass 2 — scan for typed throw statements.
  // -------------------------------------------------------------------------
  for (let ln = 0; ln < lines.length; ln++) {
    const lineNumber = ln + 1; // 1-based
    if (inRanges(lineNumber, ranges)) {
      extractSignalsFromThrow(lines[ln], fileRef, lineNumber, found);
    }
  }

  return found;
}

/**
 * Extract canonical diagnostic signals from a TypeScript/JavaScript source text.
 * Scans the entire file.
 *
 * @param sourceText  Full text of the source file.
 * @param fileRef     A short label used in `location` fields, e.g. "server.ts".
 */
export function extractSignals(sourceText: string, fileRef: string): ExtractionResult {
  const lines = removeBlockCommentLines(sourceText.split("\n")).map(stripLineComment);
  const found = runExtraction(lines, fileRef, undefined);

  return {
    signals: Array.from(found.values()),
    missingSignals: CANONICAL_SIGNAL_NAMES.filter((name) => !found.has(name)),
  };
}

/**
 * Extract canonical diagnostic signals restricted to the supplied line ranges.
 *
 * Use this when you want to scope extraction to the execution path identified
 * by the diff-scanner — e.g. only the changed lines of the payment-failure
 * handler — so that unrelated branches (unchanged else-blocks, error handlers,
 * etc.) do not contribute signals to the comparison.
 *
 * A logger call is included when its opening line falls within a range.
 * A throw statement is included when it falls within a range.
 *
 * @param sourceText  Full text of the source file.
 * @param fileRef     A short label used in `location` fields, e.g. "server.ts".
 * @param ranges      1-based line ranges to restrict scanning (from diff-scanner).
 */
export function extractSignalsInRanges(
  sourceText: string,
  fileRef: string,
  ranges: LineRange[]
): ExtractionResult {
  const lines = removeBlockCommentLines(sourceText.split("\n")).map(stripLineComment);
  const found = runExtraction(lines, fileRef, ranges);

  return {
    signals: Array.from(found.values()),
    missingSignals: CANONICAL_SIGNAL_NAMES.filter((name) => !found.has(name)),
  };
}
