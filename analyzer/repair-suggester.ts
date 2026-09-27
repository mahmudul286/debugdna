/**
 * DebugDNA — deterministic repair suggester.
 *
 * Accepts a ComparisonResult and the changed source text.
 * Derives a RepairSuggestion whose patch restores exactly the lost diagnostic
 * signal fields and fixes the error propagation.
 *
 * Strategy:
 * - An internal SIGNAL_SOURCE_MAP holds the canonical source fragment for each
 *   of the 7 diagnostic signal names.
 * - For each lost signal, the corresponding fragment is inserted into the
 *   degraded logger.error({…}) call in the changed source.
 * - A PROPAGATION_FIX replaces `next(new Error("Payment failed"))` with a
 *   direct res.status(502).json({…}) response, preserving the original error
 *   fields in the HTTP response (matching baseline behavior).
 * - The patch is returned as a unified diff string (for display).
 * - Pure function — no filesystem, no network, no child processes.
 * - Does NOT read the baseline source file at runtime.
 */

import type { ComparisonResult, RepairSuggestion } from "./types";

// ---------------------------------------------------------------------------
// Internal signal-to-source fragment map
// ---------------------------------------------------------------------------

/**
 * Maps each canonical signal name to the exact source fragment that captures
 * it in the payment-error handler of the synthetic-app.
 *
 * These fragments are inserted verbatim into the repaired logger.error(…) call.
 */
const SIGNAL_SOURCE_MAP: Record<string, string> = {
  requestId: "requestId",
  orderId: "orderId",
  paymentProvider: "paymentProvider: err.provider",
  operation: 'operation: "chargePayment"',
  errorType: "errorType: err.name",
  errorCode: "errorCode: err.code",
  originalMessage: "originalMessage: err.originalMessage",
};

/**
 * The degraded error-propagation line that must be replaced.
 * In the changed version the original PaymentError is discarded and a generic
 * Error is forwarded via `next(…)`, losing correlation fields in the response.
 */
const DEGRADED_PROPAGATION = 'next(new Error("Payment failed"))';

/**
 * The corrected propagation: respond directly with 502 and include requestId
 * and errorCode in the body, exactly as the baseline does.
 *
 * Using `throw err` inside an async Express 4 handler would create an
 * unhandled promise rejection (Express 4 does not catch async throws unless
 * express-async-errors or similar is installed).  A direct res.status(502)
 * call is the correct, Express-safe repair.
 */
const FIXED_PROPAGATION = "res.status(502).json({ requestId, errorCode: err.code })";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Locate the single degraded `logger.error({…})` call in the payment-error
 * branch of the changed source.
 *
 * We identify it as the *first* `logger.error({` whose object literal contains
 * no recognised signal fragments other than `requestId` / `orderId` — i.e. the
 * call whose body we need to expand.
 *
 * Returns the start and end indices (inclusive) of the full call text so we
 * can replace it precisely.
 */
function findDegradedLoggerCall(source: string): { start: number; end: number; callText: string } | null {
  // Find every logger.error({ occurrence.
  const callStartRe = /logger\.error\(\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = callStartRe.exec(source)) !== null) {
    const openParen = source.indexOf("(", match.index);
    if (openParen === -1) continue;

    // Walk forward counting brace/paren depth to find the closing ); 
    let depth = 0;
    let i = openParen;
    let closed = -1;
    while (i < source.length) {
      const ch = source[i];
      if (ch === "(" || ch === "{") depth++;
      else if (ch === ")" || ch === "}") {
        depth--;
        if (depth === 0) {
          closed = i;
          break;
        }
      }
      i++;
    }
    if (closed === -1) continue;

    const callText = source.slice(match.index, closed + 1);

    // Check whether this is the degraded call: it should NOT contain any of
    // the signal fragments that belong only in the full structured call.
    const hasPaymentProvider = callText.includes("paymentProvider");
    const hasOperation = callText.includes("operation");
    const hasErrorType = callText.includes("errorType");
    const hasErrorCode = callText.includes("errorCode");
    const hasOriginalMessage = callText.includes("originalMessage");

    const isDegraded =
      !hasPaymentProvider &&
      !hasOperation &&
      !hasErrorType &&
      !hasErrorCode &&
      !hasOriginalMessage;

    if (isDegraded) {
      return { start: match.index, end: closed, callText };
    }
  }

  return null;
}

/**
 * Build the repaired logger.error(…) call text by inserting the source
 * fragments for each lost signal into the object literal.
 *
 * The fragments are inserted in CANONICAL_SIGNAL_NAMES order so the output is
 * deterministic regardless of the order in which lost signals are supplied.
 */
function buildRepairedLoggerCall(lostSignalNames: string[]): string {
  const CANONICAL_ORDER = [
    "requestId",
    "orderId",
    "paymentProvider",
    "operation",
    "errorType",
    "errorCode",
    "originalMessage",
  ];

  // Always include requestId and orderId (they are preserved but we rebuild the full call).
  const allSignals = new Set([...CANONICAL_ORDER.slice(0, 2), ...lostSignalNames]);
  const orderedFragments = CANONICAL_ORDER.filter((name) => allSignals.has(name))
    .map((name) => `        ${SIGNAL_SOURCE_MAP[name] ?? name}`);

  return `logger.error({\n${orderedFragments.join(",\n")},\n      })`;
}

/**
 * Generate a minimal unified diff string showing the change from `oldText`
 * to `newText` within the context of the full source file.
 *
 * This is a simplified "display-only" diff — it shows the removed (-) and
 * added (+) lines with a small context window. It is not intended to be
 * applied by a `patch` binary; the verifier uses direct string replacement.
 */
function buildUnifiedDiff(
  oldSource: string,
  newSource: string,
  fileName: string
): string {
  const oldLines = oldSource.split("\n");
  const newLines = newSource.split("\n");

  // Find the range of lines that differ.
  let firstDiff = -1;
  let lastDiffOld = -1;
  let lastDiffNew = -1;

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (oldLines[i] !== newLines[i]) {
      if (firstDiff === -1) firstDiff = i;
      lastDiffOld = i < oldLines.length ? i : lastDiffOld;
      lastDiffNew = i < newLines.length ? i : lastDiffNew;
    }
  }

  if (firstDiff === -1) {
    // No differences found.
    return `--- a/${fileName}\n+++ b/${fileName}\n(no changes)\n`;
  }

  const CONTEXT = 3;
  const oldStart = Math.max(0, firstDiff - CONTEXT);
  const oldEnd = Math.min(oldLines.length - 1, Math.max(lastDiffOld, lastDiffNew) + CONTEXT);
  const newEnd = Math.min(newLines.length - 1, Math.max(lastDiffOld, lastDiffNew) + CONTEXT);

  const hunkOldStart = oldStart + 1; // 1-based
  const hunkNewStart = oldStart + 1;

  const diffLines: string[] = [
    `--- a/${fileName}`,
    `+++ b/${fileName}`,
  ];

  // Build the hunk — walk line-by-line comparing old and new.
  const hunkBody: string[] = [];
  let oldIdx = oldStart;
  let newIdx = oldStart;
  let oldCount = 0;
  let newCount = 0;

  while (oldIdx <= oldEnd || newIdx <= newEnd) {
    const oldLine = oldLines[oldIdx];
    const newLine = newLines[newIdx];

    if (oldIdx > oldEnd) {
      // Only new lines remain.
      hunkBody.push(`+${newLine ?? ""}`);
      newCount++;
      newIdx++;
    } else if (newIdx > newEnd) {
      // Only old lines remain.
      hunkBody.push(`-${oldLine ?? ""}`);
      oldCount++;
      oldIdx++;
    } else if (oldLine === newLine) {
      hunkBody.push(` ${oldLine}`);
      oldCount++;
      newCount++;
      oldIdx++;
      newIdx++;
    } else {
      // Lines differ — emit old as removed, new as added.
      hunkBody.push(`-${oldLine}`);
      oldCount++;
      oldIdx++;
      hunkBody.push(`+${newLine}`);
      newCount++;
      newIdx++;
    }
  }

  diffLines.push(`@@ -${hunkOldStart},${oldCount} +${hunkNewStart},${newCount} @@`);
  diffLines.push(...hunkBody);

  return diffLines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic RepairSuggestion from the comparison result and the
 * changed source text.
 *
 * @param comparison    The result of compareSnapshots(baseline, changed).
 * @param changedSource The full text of the changed source file.
 * @param targetFile    The relative path label for the target file (default: "synthetic-app/changed/server.ts").
 * @throws              If the degraded logger.error call cannot be located in changedSource.
 */
export function suggestRepair(
  comparison: ComparisonResult,
  changedSource: string,
  targetFile = "synthetic-app/changed/server.ts"
): RepairSuggestion {
  const lostNames = comparison.lostSignals.map((s) => s.name);

  // Locate the degraded logger.error call in the changed source.
  const location = findDegradedLoggerCall(changedSource);
  if (location === null) {
    throw new Error(
      `repair-suggester: could not locate a degraded logger.error call in the provided source. ` +
        `Ensure the changed source contains a logger.error({…}) call in the payment-error branch ` +
        `that is missing the diagnostic signal fields (paymentProvider, operation, errorType, errorCode, originalMessage).`
    );
  }

  // Build the repaired logger call.
  const repairedCall = buildRepairedLoggerCall(lostNames);

  // Replace the degraded logger call in the full source.
  let repairedSource = changedSource.slice(0, location.start) + repairedCall + changedSource.slice(location.end + 1);

  // Apply propagation fix: replace the degraded next(new Error(…)) with throw err.
  if (repairedSource.includes(DEGRADED_PROPAGATION)) {
    repairedSource = repairedSource.replace(DEGRADED_PROPAGATION, FIXED_PROPAGATION);
  }

  // Build the unified diff for display.
  const patch = buildUnifiedDiff(changedSource, repairedSource, targetFile);

  // Build signalMappings — one entry per lost signal.
  const signalMappings: Record<string, string> = {};
  for (const name of lostNames) {
    if (name in SIGNAL_SOURCE_MAP) {
      signalMappings[name] = SIGNAL_SOURCE_MAP[name];
    }
  }

  const lostList = lostNames.join(", ");
  const description =
    `Restore ${lostNames.length} lost diagnostic signal(s) (${lostList}) ` +
    `in the payment-error logger.error call and fix error propagation ` +
    `(replace \`${DEGRADED_PROPAGATION}\` with direct 502 response including ` +
    `requestId and errorCode).`;

  return {
    targetFile,
    targetSymbol: "app.post /api/orders/:orderId/payment",
    description,
    patch,
    signalMappings,
  };
}
