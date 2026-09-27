# DebugDNA — Implementation Plan

## Top-Level Overview

**Goal:** Build a hackathon MVP that detects regressions in failure diagnosability when a code change preserves functional behavior but degrades the evidence available to diagnose that failure.

**Scope:**
- A synthetic Node.js/TypeScript order-payment API (`synthetic-app/`) with a baseline version and an intentionally degraded changed version.
- A deterministic TypeScript analyzer pipeline (`analyzer/`) that diffs code paths, runs controlled failures, captures diagnostic evidence, compares it, identifies lost signals, suggests a repair, re-runs verification, and produces a report.
- A Next.js/TypeScript/Tailwind CSS developer UI with pages at `app/`, components at `components/`, that walks through each pipeline stage interactively.
- An optional IBM watsonx.ai / Granite explanation layer that can narrate the regression in plain language but is never the source of truth. The deterministic pipeline is fully functional without any IBM credentials.

**Non-goals:**
- API contract drift detection
- Generic code review
- Test-plan validation
- Generic observability dashboard
- Invariant checking

**Central question answered by the product:**
> "After this code change, can an engineer still diagnose the same failure with comparable evidence?"

**Approach:** All detection, comparison, repair suggestion, and verification is deterministic. Granite, if enabled, only produces a human-readable explanation of what the deterministic engine already found.

---

## Repository Structure

```
debugdna/
├── synthetic-app/
│   ├── baseline/
│   │   ├── server.ts           # Express HTTP API — rich diagnostic logging
│   │   ├── payment-provider.ts # Simulated provider — injects timeout / service errors
│   │   └── logger.ts           # Structured JSON logger
│   ├── changed/
│   │   ├── server.ts           # Same functional behavior, degraded logging
│   │   ├── payment-provider.ts # Same as baseline (unchanged)
│   │   └── logger.ts           # Same as baseline (unchanged)
│   └── repaired/               # Generated at runtime by verifier — not committed
│       └── server.ts           # Repair applied; re-run to verify restoration
│
├── analyzer/
│   ├── types.ts                # Shared data model (all interfaces)
│   ├── diff-scanner.ts         # Compares source files, extracts changed code paths
│   ├── signal-extractor.ts     # Static analysis: finds log/error signal declarations
│   ├── failure-runner.ts       # Spawns app, fires HTTP request with failure injected
│   ├── evidence-collector.ts   # Captures stdout/stderr structured log lines
│   ├── comparator.ts           # Diffs baseline vs changed EvidenceSnapshot
│   ├── repair-suggester.ts     # Deterministic repair: restores lost signal fields from lost-signal set
│   ├── verifier.ts             # Re-runs failure against repaired version
│   ├── report-builder.ts       # Assembles the final DiagnosticReport
│   └── granite-explainer.ts    # Optional: sends report to Granite for narration only
│
├── app/                        # Next.js App Router pages
│   ├── page.tsx                # Dashboard — entry point
│   ├── analysis/
│   │   └── page.tsx            # Live pipeline progress
│   ├── report/
│   │   └── page.tsx            # Final report viewer
│   └── api/
│       └── run-analysis/
│           └── route.ts        # POST — triggers full pipeline, streams SSE progress
│
├── components/
│   ├── SignalMap.tsx            # Signal declaration diff table (embedded in EvidenceDiff if time-constrained)
│   ├── EvidenceDiff.tsx        # Side-by-side baseline vs changed evidence
│   ├── RepairView.tsx          # Suggested patch + diff
│   ├── VerificationBadge.tsx   # Pass/fail restoration status
│   └── ReportSummary.tsx       # Full aggregated report card
│
├── lib/
│   └── api.ts                  # Client-side SSE consumer for run-analysis route
│
├── bob_sessions/               # Bob IDE session screenshots (required by hackathon)
│
├── tests/
│   ├── analyzer/               # Unit tests for evidence-collector, comparator, diff-scanner,
│   │                           #   signal-extractor, repair-suggester, granite-explainer
│   └── synthetic-app/          # Integration/E2E tests for failure-runner, verifier, full pipeline
│
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
└── README.md
```

---

## Data Model (`analyzer/types.ts`)

The 7 canonical diagnostic signals are:
`requestId`, `orderId`, `paymentProvider`, `operation`, `errorType`, `errorCode`, `originalMessage`

`timestamp` is treated as log metadata only. It is stored in `capturedAt` on `EvidenceSnapshot` and must NOT appear in `expectedSignals`, signal comparison, severity calculation, repair, or verification.

```typescript
// A single observable diagnostic field present in a log or error.
// The 7 canonical signal names are the only names that participate in
// comparison, severity, repair, and verification.
export interface DiagnosticSignal {
  name: string;           // one of the 7 canonical names
  category: "log" | "error" | "context";
  location: string;       // file + line reference, e.g. "server.ts:42"
  present: boolean;       // whether this signal was observed in the run
  value?: string;         // observed value, if captured
}

// All diagnostic evidence captured from one run.
// rawLogLines includes timestamp as metadata but timestamp is NOT a signal.
export interface EvidenceSnapshot {
  version: "baseline" | "changed" | "repaired";
  scenarioId: string;     // e.g. "payment-provider-timeout"
  signals: DiagnosticSignal[];    // only the 7 canonical signal fields
  rawLogLines: string[];
  capturedAt: number;     // Unix ms — log metadata only, not a signal
}

// Result of comparing baseline vs changed.
// Severity thresholds (based on number of lost signals out of 7):
//   0 lost = "none"
//   1 lost = "low"
//   2–3 lost = "medium"
//   4–5 lost = "high"
//   6–7 lost = "critical"
// Demo scenario loses 5 of 7 → severity = "high"
export interface ComparisonResult {
  baseline: EvidenceSnapshot;
  changed: EvidenceSnapshot;
  lostSignals: DiagnosticSignal[];
  gainedSignals: DiagnosticSignal[];
  preservedSignals: DiagnosticSignal[];
  severity: "none" | "low" | "medium" | "high" | "critical";
}

// A deterministic patch to restore lost signals.
// The patch is derived from the lost-signal set and the changed source context.
// It does NOT copy the baseline source wholesale.
// signalMappings records the per-signal template fragments that were inserted.
export interface RepairSuggestion {
  targetFile: string;
  targetSymbol: string;
  description: string;
  patch: string;              // unified diff format, for display
  signalMappings: Record<string, string>; // signal name → source fragment restored
}

// Result of the verification re-run.
// restored is true only when EVERY individual lost signal name reappears —
// signal count alone is not sufficient.
export interface VerificationResult {
  restored: boolean;
  restoredSignals: DiagnosticSignal[];
  stillMissing: DiagnosticSignal[];
  repaired: EvidenceSnapshot;
}

// Full pipeline output
export interface DiagnosticReport {
  runId: string;
  scenario: FailureScenario;
  comparison: ComparisonResult;
  repair: RepairSuggestion;
  verification: VerificationResult;
  graniteExplanation?: string;   // only present when WATSONX_API_KEY is set
}

// A controlled failure scenario.
// expectedSignals contains exactly the 7 canonical signal names — never "timestamp".
export interface FailureScenario {
  id: string;
  description: string;
  endpoint: string;       // e.g. "POST /api/orders/:orderId/payment"
  injectedCondition: "timeout" | "service-error";
  expectedSignals: string[]; // must be a subset of the 7 canonical signal names
}
```

---

## Sub-Tasks

---

### Sub-Task 1 — Project Scaffold

**Status:** `[x] done`

**Intent:**
Initialize the monorepo with Next.js, TypeScript, Tailwind CSS, and Vitest. Create the directory structure, `package.json`, `tsconfig.json`, and `next.config.mjs`. No application logic yet.

**Expected Outcomes:**
- `npm install` succeeds.
- `npm run dev` starts the Next.js server with no errors.
- `npm test` runs Vitest with zero tests (no failures).
- All config files are in place.

**Todo List:**
1. Create root `package.json` with all dependencies: next, react, react-dom, typescript, tailwindcss, autoprefixer, postcss, vitest, @vitejs/plugin-react, tsx, express, @types/express, @types/node, node-fetch.
2. Create `tsconfig.json` targeting ES2022, module NodeNext, strict mode on.
3. Create `next.config.ts`.
4. Create `tailwind.config.ts` and `postcss.config.js`.
5. Create the full directory tree (all folders listed in Repository Structure above, with `.gitkeep` where needed).
6. Create a minimal `ui/app/page.tsx` placeholder.
7. Create `README.md` with project description and `npm` commands.

**Relevant Context:**
- No existing files; workspace is empty.
- Stack: Next.js 14 App Router, TypeScript strict, Tailwind CSS 3, Vitest 1.

---

### Sub-Task 2 — Synthetic Demo Application (Baseline)

**Status:** `[ ] pending`

**Intent:**
Build the baseline version of the synthetic order-payment API. This is the "healthy" version: failures are real and fully diagnosable. It is the reference point that DebugDNA protects.

**Expected Outcomes:**
- `synthetic-app/baseline/server.ts` starts an Express server on a configurable port.
- `POST /api/orders/:orderId/payment` calls the simulated payment provider.
- The provider can be forced to fail via an environment variable (`PAYMENT_FAILURE_MODE=timeout|service-error`).
- On failure, the server logs a structured JSON object containing all 7 required diagnostic signal fields: `requestId`, `orderId`, `paymentProvider`, `operation`, `errorType`, `errorCode`, `originalMessage`. `timestamp` is included in log output as metadata only and is not part of the signal set.
- The HTTP response returns 502 with a JSON body that includes `requestId` and `errorCode` (so the caller can correlate).
- The original error is preserved (not swallowed).
- A Vitest integration test confirms the structured log fields are all present on failure.

**Todo List:**
1. Create `synthetic-app/baseline/logger.ts` — a thin wrapper around `console.error`/`console.log` that emits newline-delimited JSON.
2. Create `synthetic-app/baseline/payment-provider.ts` — async function `chargePayment(orderId)` that reads `PAYMENT_FAILURE_MODE` and throws a typed `PaymentError` with `code`, `provider`, and `originalMessage`.
3. Create `synthetic-app/baseline/server.ts` — Express app, payment route, structured error logging, 502 response.
4. Write a Vitest test in `tests/synthetic-app/baseline.test.ts` that spawns the server (via `failure-runner`), sends a POST with `PAYMENT_FAILURE_MODE=timeout`, and asserts all 7 canonical signal fields appear in the captured evidence. This test is integration/E2E because it starts a real child process.

**Relevant Context:**
- `PAYMENT_FAILURE_MODE` env var controls failure injection — no network calls, no side effects.
- All 7 required fields become the `expectedSignals` in the `FailureScenario` definition.
- The test in step 4 is also the template for `failure-runner.ts` in the analyzer.

---

### Sub-Task 3 — Synthetic Demo Application (Changed Version)

**Status:** `[ ] pending`

**Intent:**
Build the intentionally degraded changed version. Functional behavior is preserved (still returns 502 on payment failure) but diagnostic evidence is substantially reduced. This is the regression that DebugDNA must detect.

**Expected Outcomes:**
- `synthetic-app/changed/server.ts` passes a basic functional test: still returns HTTP 502 on payment failure.
- The structured log on failure is missing exactly 5 of the 7 canonical signal fields: `paymentProvider`, `operation`, `errorType`, `errorCode`, `originalMessage` are gone. Only `requestId` and `orderId` remain.
- The original `PaymentError` is wrapped in a generic `new Error("Payment failed")` — the cause chain is lost.
- A Vitest test confirms functional parity but also asserts that the missing signals are indeed absent from stdout.

**Degradation techniques to apply (all deterministic, all visible in a diff):**
1. Replace the structured log call with `logger.error("Payment failed", { requestId, orderId })` — strip `paymentProvider`, `operation`, `errorType`, `errorCode`, `originalMessage`.
2. Wrap the caught error: `throw new Error("Payment failed")` instead of re-throwing the original `PaymentError`.
3. Return a generic 502 body `{ error: "Payment failed" }` — remove `requestId` and `errorCode` from the response.

**Todo List:**
1. Copy `synthetic-app/baseline/` to `synthetic-app/changed/`.
2. Edit `changed/server.ts` to apply the three degradation techniques above.
3. Write a Vitest test in `tests/synthetic-app/changed.test.ts` that: (a) asserts HTTP 502 is still returned, (b) asserts missing signals are not present in stdout.

**Relevant Context:**
- The diff between `baseline/server.ts` and `changed/server.ts` is the primary input to the diff-scanner in Sub-Task 4.
- The missing signals list must match the `lostSignals` output the comparator will produce.

---

### Sub-Task 4 — Analyzer: Diff Scanner + Signal Extractor

**Status:** `[ ] pending`

**Intent:**
Implement the first two stages of the deterministic analyzer pipeline. The diff scanner identifies which code paths changed. The signal extractor performs static analysis on both versions to enumerate which of the 7 canonical diagnostic signal fields were declared in the logging and error-handling code.

**Expected Outcomes:**
- `diff-scanner.ts` reads baseline and changed source files and returns a structured list of changed functions/blocks and the line ranges that changed.
- `signal-extractor.ts` parses source text with regex patterns targeting `logger.error(...)` calls and `throw` statements, and returns an array of `DiagnosticSignal` declarations per version.
- The extractor correctly identifies that baseline declares all 7 canonical signals and changed declares 2 (`requestId`, `orderId`) in the error logging call.
- `timestamp` is never included in extracted signals — the extractor explicitly filters it out.
- Unit tests in `tests/analyzer/` verify both modules against fixture source files (pure string input, no child processes).

**Determinism note:**
- No AI involvement at this stage.
- Signal extraction uses lexical patterns (regex over source text), not AST parsing, to keep the implementation simple and demo-reliable.

**Todo List:**
1. Create `analyzer/types.ts` with the full data model defined above.
2. Implement `analyzer/diff-scanner.ts` — reads two files, produces line-level diff using a simple line comparison, returns `{ changedRanges: LineRange[], affectedFunctions: string[] }`.
3. Implement `analyzer/signal-extractor.ts` — regex patterns target: (a) `logger.error` / `logger.warn` call argument object keys, (b) thrown error type names. Filter out `timestamp` explicitly. Only match against the 7 canonical signal names.
4. Write pure unit tests for both modules using inline fixture strings (copies of key sections of `synthetic-app/baseline/server.ts` and `changed/server.ts`). No child processes.

**Relevant Context:**
- The 7 canonical signal names the extractor recognises: `requestId`, `orderId`, `paymentProvider`, `operation`, `errorType`, `errorCode`, `originalMessage`.
- `timestamp` must be explicitly excluded from signal extraction even if it appears in log output.
- Patterns in throw statements: `throw new PaymentError(...)` vs `throw new Error("Payment failed")`.
- These are pure, fast unit tests — no network, no filesystem, no spawned processes.

---

### Sub-Task 5 — Analyzer: Failure Runner + Evidence Collector

**Status:** `[ ] pending`

**Intent:**
Implement the controlled failure injection and evidence capture stages. The failure runner starts a version of the synthetic app, fires the exact HTTP request that triggers the failure scenario, and the evidence collector captures and parses the resulting structured log output.

**Test classification:**
- `evidence-collector.ts` — **unit-testable** (accepts raw string input; no processes, no network).
- `failure-runner.ts` — **integration/E2E** (spawns a real localhost child process and sends HTTP requests; cannot be meaningfully tested without a running server).

**Expected Outcomes:**
- `failure-runner.ts` starts either the baseline or changed app as a child process, sends the payment POST with `PAYMENT_FAILURE_MODE=timeout`, waits for the response, collects stdout/stderr, kills the process, and returns the raw output.
- `evidence-collector.ts` accepts raw stdout string, parses newline-delimited JSON log lines, extracts field names, filters to the 7 canonical signal names only, and builds an `EvidenceSnapshot`. `timestamp` is stored in `capturedAt` as metadata and excluded from `signals`.
- Integration tests (in `tests/synthetic-app/`) confirm baseline produces 7 signals present and changed produces exactly 2 signals present.

**Todo List:**
1. Implement `analyzer/evidence-collector.ts` — pure function: parse raw log string → `EvidenceSnapshot`. Filter to canonical signal names only; store any `timestamp` value in `capturedAt`, not in `signals`.
2. Write pure unit tests for `evidence-collector` using fixture log strings (no child processes).
3. Implement `analyzer/failure-runner.ts` — spawn child process, set env vars, wait for `"Server listening"` in stdout, fire POST to random port, collect output, kill process.
4. Write integration tests for `failure-runner` + `evidence-collector` combined, against both the baseline and changed apps.

**Relevant Context:**
- The `FailureScenario` type drives the runner: `injectedCondition` maps to `PAYMENT_FAILURE_MODE`, `endpoint` is the URL path.
- The runner must use a random available port to avoid CI conflicts.
- Ready detection: watch for `"Server listening"` in stdout before firing the request.
- Integration tests go in `tests/synthetic-app/`, not `tests/analyzer/`.

---

### Sub-Task 6 — Analyzer: Comparator + Repair Suggester

**Status:** `[ ] pending`

**Intent:**
Implement the comparison engine that diffs two `EvidenceSnapshot` objects and identifies lost signals. Then implement the deterministic repair suggester that derives a concrete code patch from the lost-signal set and the changed source context — not by copying the baseline.

**Expected Outcomes:**
- `comparator.ts` takes baseline and changed `EvidenceSnapshot` objects and returns a `ComparisonResult` with correctly classified `lostSignals`, `gainedSignals`, `preservedSignals`, and a `severity` rating.
- Demo scenario: 5 lost signals → severity = `"high"`.
- `repair-suggester.ts` takes the `ComparisonResult` and the changed source text and returns a `RepairSuggestion` whose patch restores exactly the lost signal fields (no more, no less) and fixes the error propagation, using per-signal template fragments.
- `signalMappings` in `RepairSuggestion` records which source fragment was inserted for each restored signal.
- Unit tests verify both modules using fixture `EvidenceSnapshot` objects and fixture source strings (pure, no child processes).

**Repair strategy (deterministic, signal-derived):**
- The suggester holds an internal `SIGNAL_SOURCE_MAP`: a record from each canonical signal name to the exact source fragment that captures it (e.g. `paymentProvider: "paymentProvider: err.provider"`, `errorCode: "errorCode: err.code"`, etc.).
- It also holds a `PROPAGATION_FIX` fragment that replaces `throw new Error("Payment failed")` with `throw err` (re-throw the original typed error).
- For each signal in `lostSignals`, it locates the degraded `logger.error(...)` call in the changed source and inserts the corresponding fragment.
- The patch is assembled as a unified diff string (for UI display) and as a string-replacement operation (for application in the verifier).
- The suggester does NOT read the baseline source file at runtime.

**Todo List:**
1. Implement `analyzer/comparator.ts` — set operations on signal names, severity thresholds (0=none, 1=low, 2–3=medium, 4–5=high, 6–7=critical).
2. Implement `analyzer/repair-suggester.ts` — `SIGNAL_SOURCE_MAP` + `PROPAGATION_FIX`, locate degraded call in source, build patched source, generate unified diff string, populate `signalMappings`.
3. Write pure unit tests for both modules using fixture snapshot objects and inline source strings.

**Relevant Context:**
- Severity producing `"high"` for 5 lost signals is required by the demo.
- The repair suggester does NOT call Granite and does NOT read baseline source at runtime.
- The `patch` field is a unified diff string for display; the verifier uses string replacement to apply it.
- Both modules are pure functions over their inputs — no filesystem, no network, no child processes.

---

### Sub-Task 7 — Analyzer: Verifier + Report Builder

**Status:** `[ ] pending`

**Intent:**
Close the pipeline loop. The verifier applies the repair patch to the changed version, re-runs the failure scenario, captures evidence, and checks whether the lost signals were restored. The report builder assembles the full `DiagnosticReport`.

**Expected Outcomes:**
- `verifier.ts` writes the patched source to `synthetic-app/repaired/server.ts`, runs the failure scenario against it, and returns a `VerificationResult`.
- `VerificationResult.restored` is `true` when all lost signals are back in the evidence.
- `report-builder.ts` takes all pipeline outputs and returns a `DiagnosticReport`.
- An end-to-end integration test runs the full pipeline from diff to report and asserts `verification.restored === true`.

**Todo List:**
1. Implement `analyzer/verifier.ts` — apply patch (using Node.js string replacement, not a shell diff tool), write to repaired directory, re-run failure runner, collect evidence, compare to expected signals.
2. Implement `analyzer/report-builder.ts` — assemble `DiagnosticReport` from all pipeline outputs.
3. Write end-to-end test: `tests/analyzer/pipeline.e2e.test.ts`.

**Relevant Context:**
- Patch application: for the demo, apply the patch as a string replacement (find the degraded logger call, replace with the full structured call). A real unified diff apply is not required for the MVP.
- The `repaired/` directory is created fresh each run; it is not committed.

---

### Sub-Task 8 — Granite Explainer (Optional Layer)

**Status:** `[ ] pending`

**Intent:**
Add an optional explanation layer that sends the completed `DiagnosticReport` to IBM watsonx.ai / Granite and receives a plain-language narration of the regression. The deterministic pipeline is fully functional and complete without this layer. Granite never creates, overrides, or changes any deterministic finding.

**Expected Outcomes:**
- `analyzer/granite-explainer.ts` sends a structured prompt to Granite and returns a `string`.
- If `WATSONX_API_KEY` is not set, the module returns `undefined` with no error thrown and no log noise.
- The full pipeline runs to completion and produces a valid `DiagnosticReport` whether or not `WATSONX_API_KEY` is present.
- The UI renders the explanation in a clearly labeled "AI Explanation (Optional)" panel, visually distinct from the deterministic findings section.
- The explanation does NOT appear in severity, signal lists, repair suggestion, or verification result.

**Prompt design:**
- Input: scenario description, list of lost signal names, severity level.
- Instruction: `"Explain in 3–5 sentences why removing these diagnostic fields makes future failure diagnosis harder for an engineer. Do not introduce any new findings beyond what is listed."`
- Output: plain prose, max 150 words.

**Todo List:**
1. Create `analyzer/granite-explainer.ts` with watsonx.ai REST call, gated on `WATSONX_API_KEY`.
2. Add graceful no-op: if key absent, return `undefined` immediately.
3. Add `graniteExplanation` field population in `report-builder.ts` (only when explainer returns a value).
4. Write a unit test with a mocked `fetch` that verifies the prompt structure and confirms `undefined` is returned when no key is set.

**Relevant Context:**
- watsonx.ai endpoint: `https://us-south.ml.cloud.ibm.com/ml/v1/text/generation`.
- Granite model: `ibm/granite-13b-instruct-v2` (confirm availability at integration time).
- The deterministic pipeline must produce `DiagnosticReport.verification.restored === true` without any IBM credentials.

---

### Sub-Task 9 — Next.js API Route

**Status:** `[ ] pending`

**Intent:**
Expose the analyzer pipeline as a Next.js API route so the UI can trigger analysis and stream progress back to the browser.

**Expected Outcomes:**
- `POST /api/run-analysis` accepts `{ scenario: FailureScenario }` and runs the full pipeline.
- Progress events are streamed using Server-Sent Events so the UI can show each stage completing in real time.
- The full `DiagnosticReport` is returned as the final SSE event.
- Error handling returns a JSON error response with a descriptive message.

**Todo List:**
1. Create `app/api/run-analysis/route.ts` as a Next.js App Router route handler.
2. Implement SSE streaming: emit `stage` events for each pipeline step (diff, extract, run-baseline, run-changed, compare, repair, verify, report).
3. Emit a final `report` event with the full `DiagnosticReport` JSON.
4. Test the route with a Vitest test that reads the SSE stream.

**Relevant Context:**
- Next.js App Router streaming: use `ReadableStream` with `TransformStream` for SSE.
- Pipeline stages map 1:1 to the analyzer modules from Sub-Tasks 4–7.

---

### Sub-Task 10 — Developer UI

**Status:** `[ ] pending`

**Intent:**
Build the four UI concepts that walk a developer through the DebugDNA analysis interactively. If implementation time is constrained, `SignalMap` is embedded inside `EvidenceDiff` rather than deleted — all four concepts are preserved.

**Screens:**

| Screen | Route | Purpose |
|---|---|---|
| Dashboard | `/` | Select scenario, trigger analysis |
| Analysis | `/analysis` | Live pipeline progress: Signal Map + Evidence Diff + Repair View |
| Report | `/report` | Full aggregated report card with Verification Badge |

**UI Concepts and their components:**

| Concept | Component | Fallback if time-constrained |
|---|---|---|
| Signal Map | `SignalMap.tsx` | Embed as a section inside `EvidenceDiff.tsx` |
| Evidence Diff | `EvidenceDiff.tsx` | Required — always present |
| Repair View | `RepairView.tsx` | Required — always present |
| Verification Badge | `VerificationBadge.tsx` | Required — always present |
| Report Summary | `ReportSummary.tsx` | Required — always present |

**Expected Outcomes:**
- `SignalMap` shows a table of all 7 signals with "present" / "lost" status badges for baseline vs changed.
- `EvidenceDiff` shows two columns of log output with highlighted missing fields.
- `RepairView` shows the `signalMappings` list and unified diff patch.
- `VerificationBadge` shows green checkmark if `restored === true`, red X otherwise.
- `ReportSummary` renders severity badge, signal counts, and the optional Granite explanation in a labeled panel.
- Severity `"high"` renders as an amber/orange badge — not red (critical) — matching the demo scenario.

**Todo List:**
1. Build `components/SignalMap.tsx`.
2. Build `components/EvidenceDiff.tsx` (with fallback slot for SignalMap if needed).
3. Build `components/RepairView.tsx`.
4. Build `components/VerificationBadge.tsx`.
5. Build `components/ReportSummary.tsx`.
6. Build `app/page.tsx` — dashboard with scenario selector and "Run Analysis" button.
7. Build `app/analysis/page.tsx` — live pipeline progress with SSE consumer, rendering all four concepts.
8. Build `app/report/page.tsx` — final report viewer.
9. Wire `lib/api.ts` to the `app/api/run-analysis/route.ts` route using SSE.

**Relevant Context:**
- Tailwind CSS for all styling; no external component libraries.
- Use React `useState` + `useEffect` for SSE consumption.
- Keep components small and data-driven; all display logic driven by `DiagnosticReport` fields.
- Severity color mapping: none=gray, low=blue, medium=yellow, high=orange, critical=red.

---

### Sub-Task 11 — Testing Strategy

**Status:** `[ ] pending`

**Intent:**
Ensure every deterministic module is covered by fast, isolated unit tests. Integration/E2E tests cover the full pipeline and the failure runner. All tests run under Vitest.

**Test classification:**

| Module | Test type | Location | What is verified |
|---|---|---|---|
| `signal-extractor` | Unit | `tests/analyzer/` | Correct 7 canonical signal names extracted; `timestamp` never appears |
| `diff-scanner` | Unit | `tests/analyzer/` | Correct line ranges and affected functions identified |
| `evidence-collector` | Unit | `tests/analyzer/` | Correct `EvidenceSnapshot` built from fixture log strings; `timestamp` in `capturedAt` not in `signals` |
| `comparator` | Unit | `tests/analyzer/` | Correct `lostSignals`, `gainedSignals`; severity = `"high"` for 5 lost |
| `repair-suggester` | Unit | `tests/analyzer/` | `signalMappings` contains all 5 lost signals; patch string restores them; no baseline source read |
| `granite-explainer` | Unit (mocked fetch) | `tests/analyzer/` | Prompt structure correct; returns `undefined` when no key |
| `failure-runner` + `evidence-collector` | Integration | `tests/synthetic-app/` | Baseline: 7 signals present; Changed: 2 signals present, HTTP 502 |
| `verifier` | Integration | `tests/synthetic-app/` | Repaired app produces 7 signals present |
| Full pipeline | E2E | `tests/synthetic-app/` | `DiagnosticReport.verification.restored === true`; severity = `"high"` |

**Todo List:**
1. Create test fixtures in `tests/analyzer/fixtures/`: inline baseline log string, inline changed log string, inline baseline source snippet, inline changed source snippet.
2. Write all unit tests listed above (pure, no child processes).
3. Write integration tests for `failure-runner` + `evidence-collector` against both apps.
4. Write E2E pipeline test asserting `restored === true` and `severity === "high"`.
5. Confirm `npm test` runs all tests cleanly.

---

### Sub-Task 12 — Bob Sessions + README

**Status:** `[ ] pending`

**Intent:**
Capture the required Bob IDE task session screenshots and finalize the README for submission.

**Expected Outcomes:**
- `bob_sessions/` contains at least 3 screenshots showing Bob being used to develop key parts of the project.
- `README.md` documents: project purpose, architecture summary, how to run, how to run tests, how to enable Granite, and the demo walkthrough steps.

**Todo List:**
1. Use Bob to implement at least one major sub-task (e.g. Sub-Task 4 or 5) and capture screenshots.
2. Add screenshots to `bob_sessions/`.
3. Write `README.md` sections: Overview, Architecture, Running Locally, Running Tests, Demo Walkthrough, Granite Setup, Limitations.

---

## Risks, False Positives, and Limitations

| Risk | Mitigation |
|---|---|
| Signal extractor false positive: regex matches a comment or string literal | Extractor only targets known function body patterns; adds a `//` comment-line filter |
| `timestamp` leaking into signal comparison | Extractor explicitly filters `timestamp`; `EvidenceSnapshot.signals` only contains canonical names |
| Severity shows `"critical"` instead of `"high"` for the demo | Threshold table is the single source of truth: 4–5 lost = `"high"` |
| Failure runner port conflict in CI | Uses a random available port; kills the child process in a `finally` block |
| Patch application fails if changed file differs from expected template | Repair suggester checks for the exact degraded pattern before applying; throws a descriptive error if not found |
| Granite API unavailable during demo | Granite is optional; `WATSONX_API_KEY` absent → `graniteExplanation` is `undefined`, report is still complete |
| Verifier declares `restored` prematurely | Verification checks each individual lost signal name, not just count |
| Demo looks too simple | Intentional — the value is in the concept and the deterministic pipeline, not the size of the demo app |

## Deterministic vs Optional AI Boundary

| Pipeline stage | Source of truth | Granite role |
|---|---|---|
| Code diff | Deterministic (line diff) | None |
| Signal extraction | Deterministic (regex, canonical list) | None |
| Failure injection | Deterministic (env var) | None |
| Evidence capture | Deterministic (stdout parse, canonical filter) | None |
| Comparison | Deterministic (set diff) | None |
| Repair suggestion | Deterministic (signal-to-source map) | None |
| Verification | Deterministic (re-run + per-signal name check) | None |
| Report narration | N/A | Granite narrates what the deterministic engine already found |

Granite never creates, overrides, or changes any deterministic finding.
The deterministic pipeline produces a complete, valid `DiagnosticReport` without any IBM credentials.
