/**
 * DebugDNA — deterministic source diff scanner.
 *
 * Compares two source texts line-by-line and returns the changed line ranges
 * plus a best-effort list of affected function/block names.
 *
 * Constraints:
 * - Pure, synchronous, deterministic.
 * - No LLM, no child processes, no network, no AST tooling.
 * - A simple line-based LCS diff is sufficient for the MVP.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A half-open range [start, end] of 1-based line numbers in the changed text. */
export interface LineRange {
  start: number; // 1-based
  end: number; // 1-based, inclusive
}

export interface DiffResult {
  changedRanges: LineRange[];
  /**
   * Function/block names whose bodies contain at least one changed line.
   * Identified by scanning backwards from the first changed line for a
   * function-like declaration. May be empty when no declaration is found.
   */
  affectedFunctions: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a simple longest-common-subsequence edit map between two line arrays.
 * Returns, for every line index in `b`, whether it is "new" (not present in
 * the same position/content in `a`).
 *
 * We use the classic DP LCS algorithm limited to a 500-line window to keep
 * memory bounded for demo files. For files longer than the window we fall
 * back to a line-hash set heuristic.
 */
function computeChangedLines(aLines: string[], bLines: string[]): boolean[] {
  const changed = new Array<boolean>(bLines.length).fill(false);

  // Fast path: identical files.
  if (aLines.join("\n") === bLines.join("\n")) {
    return changed;
  }

  const MAX_LCS_LINES = 500;

  if (aLines.length <= MAX_LCS_LINES && bLines.length <= MAX_LCS_LINES) {
    // Full LCS DP.
    const m = aLines.length;
    const n = bLines.length;
    // dp[i][j] = LCS length for aLines[0..i-1], bLines[0..j-1]
    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      new Array<number>(n + 1).fill(0)
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          aLines[i - 1] === bLines[j - 1]
            ? dp[i - 1][j - 1] + 1
            : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    // Backtrack to find which lines in b are unchanged.
    const unchanged = new Set<number>(); // 0-based indices into bLines
    let i = m;
    let j = n;
    while (i > 0 && j > 0) {
      if (aLines[i - 1] === bLines[j - 1]) {
        unchanged.add(j - 1);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    for (let k = 0; k < bLines.length; k++) {
      changed[k] = !unchanged.has(k);
    }
  } else {
    // Heuristic fallback: a line is "changed" if it does not appear verbatim
    // in a.  This over-reports for duplicated lines but is fine for the demo.
    const aSet = new Set(aLines);
    for (let k = 0; k < bLines.length; k++) {
      changed[k] = !aSet.has(bLines[k]);
    }
  }

  return changed;
}

/** Collapse a boolean mask of changed lines into contiguous LineRange blocks. */
function toRanges(changedMask: boolean[]): LineRange[] {
  const ranges: LineRange[] = [];
  let inRange = false;
  let rangeStart = 0;

  for (let i = 0; i < changedMask.length; i++) {
    if (changedMask[i] && !inRange) {
      inRange = true;
      rangeStart = i + 1; // convert to 1-based
    } else if (!changedMask[i] && inRange) {
      ranges.push({ start: rangeStart, end: i }); // i is 1-based end of previous
      inRange = false;
    }
  }
  if (inRange) {
    ranges.push({ start: rangeStart, end: changedMask.length });
  }
  return ranges;
}

/**
 * Patterns that identify function/method/arrow-function declarations.
 * We scan *backwards* from a changed line to find the nearest enclosing
 * declaration.
 */
const FUNCTION_DECLARATION_RE =
  /(?:^|\s)(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(|(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)|(\w+)\s*\([^)]*\)\s*(?::\s*\S+\s*)?\{|app\.\w+\([^)]+,\s*(?:async\s+)?\([^)]*\))/;

function extractFunctionName(line: string): string | null {
  // Named function declaration: function foo(
  let m = line.match(/\bfunction\s+(\w+)\s*\(/);
  if (m) return m[1];

  // Arrow / const assignment: const foo = ( or const foo = async (
  m = line.match(/\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
  if (m) return m[1];

  // Express route handler: app.post/get/put/delete/use(...)
  m = line.match(/\bapp\.(\w+)\s*\(/);
  if (m) return `app.${m[1]}`;

  // Method shorthand in object/class: methodName(
  m = line.match(/^\s{0,4}(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\S+\s*)?\{/);
  if (m) return m[1];

  return null;
}

/**
 * Given the lines of the changed file and the changed-line mask, return the
 * names of functions whose bodies overlap with any changed line.
 */
function findAffectedFunctions(lines: string[], changedMask: boolean[]): string[] {
  const names = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    if (!changedMask[i]) continue;

    // Scan backwards from line i to find the nearest function declaration.
    for (let j = i; j >= 0; j--) {
      const name = extractFunctionName(lines[j]);
      if (name) {
        names.add(name);
        break;
      }
    }
  }

  return Array.from(names);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan two source texts and return which line ranges changed and which
 * function/block names are affected.
 *
 * @param baselineSource  Full text of the baseline source file.
 * @param changedSource   Full text of the changed source file.
 */
export function scanDiff(baselineSource: string, changedSource: string): DiffResult {
  const aLines = baselineSource.split("\n");
  const bLines = changedSource.split("\n");

  const changedMask = computeChangedLines(aLines, bLines);
  const changedRanges = toRanges(changedMask);
  const affectedFunctions = findAffectedFunctions(bLines, changedMask);

  return { changedRanges, affectedFunctions };
}
