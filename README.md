# DebugDNA — Diagnosability Regression Tester

> **Hackathon project** — built with IBM Bob IDE.

## What is DebugDNA?

DebugDNA detects regressions in *failure diagnosability* caused by code changes.

A software change can preserve functional behavior while silently removing the
diagnostic evidence an engineer needs to diagnose future failures.
Existing CI workflows check whether code **works** — they do not check whether
failures remain **diagnosable**.

DebugDNA answers the question:

> "After this code change, can an engineer still diagnose the same failure
> with comparable evidence?"

---

## Architecture Overview

```
synthetic-app/        Synthetic order-payment API (baseline + changed + repaired)
analyzer/             Deterministic analysis pipeline
  types.ts            Shared data model
  diff-scanner.ts     Identifies changed code paths
  signal-extractor.ts Extracts diagnostic signal declarations (static analysis)
  failure-runner.ts   Injects controlled failures via child process
  evidence-collector.ts Captures and parses diagnostic evidence from stdout
  comparator.ts       Compares baseline vs changed evidence snapshots
  repair-suggester.ts Derives a deterministic repair from the lost-signal set
  verifier.ts         Re-runs failure against repaired version
  report-builder.ts   Assembles the final DiagnosticReport
  granite-explainer.ts Optional: plain-language narration via IBM watsonx.ai
app/                  Next.js 14 App Router pages
  page.tsx            Dashboard
  analysis/page.tsx   Live pipeline progress
  report/page.tsx     Final report viewer
  api/run-analysis/   SSE streaming API route
components/           React UI components
lib/                  SSE client
tests/
  analyzer/           Unit tests (pure, no child processes)
  synthetic-app/      Integration + E2E tests (real child processes)
bob_sessions/         Bob IDE session screenshots (hackathon requirement)
```

---

## Running Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Running Tests

```bash
npm test
```

Unit tests run in `tests/analyzer/`.
Integration and E2E tests run in `tests/synthetic-app/`.

---

## Type Check

```bash
npm run typecheck
```

---

## Demo Walkthrough

1. Open the dashboard at `/`.
2. Select the **Payment Provider Timeout** failure scenario.
3. Click **Run Analysis**.
4. Watch the pipeline progress through 8 stages in real time.
5. Review the **Signal Map** — 7 signals in baseline, 2 in changed.
6. Review the **Evidence Diff** — 5 signals lost.
7. Review the **Repair Suggestion** — per-signal source fragments restored.
8. Click **Verify Repair** — pipeline re-runs against the repaired version.
9. Review the **Verification Badge** — green = all signals restored.
10. View the **Final Report** — severity HIGH, 5/7 signals restored.

---

## Granite Setup (Optional)

Copy `.env.example` to `.env.local` and fill in your IBM watsonx.ai credentials:

```env
# Required to enable Granite explanations
WATSONX_API_KEY=your_ibm_cloud_iam_api_key
WATSONX_PROJECT_ID=your_watsonx_project_id

# Optional — defaults shown below
WATSONX_MODEL_ID=ibm/granite-3-8b-instruct
WATSONX_REGION=us-south
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `WATSONX_API_KEY` | For Granite only | — | IBM Cloud IAM API key |
| `WATSONX_PROJECT_ID` | For Granite only | — | watsonx.ai project ID |
| `WATSONX_MODEL_ID` | No | `ibm/granite-3-8b-instruct` | Granite model identifier |
| `WATSONX_REGION` | No | `us-south` | watsonx.ai region slug |

All credentials are **server-side only** — they are never exposed to the browser or
included in the client bundle.

When `WATSONX_API_KEY` is absent or any watsonx.ai call fails, the Granite explainer
returns `undefined` silently. The deterministic pipeline remains fully functional
and the `DiagnosticReport` remains valid without `graniteExplanation`.

---

## Limitations

- Signal extraction uses regex over source text, not full AST parsing.
  Reliable for the synthetic demo app; not a general-purpose code analyzer.
- The repair suggester targets the exact degradation pattern in the demo.
  It is not a general auto-repair engine.
- The Granite explanation layer is additive only — it does not affect
  any deterministic finding.
- No personal, client, or confidential data is used. All data is synthetic.

---

## Implementation Status

| Sub-Task | Description | Status |
|---|---|---|
| 1 | Project Scaffold | ✅ Done |
| 2 | Synthetic App — Baseline | ⏳ Pending |
| 3 | Synthetic App — Changed | ⏳ Pending |
| 4 | Analyzer: types + diff-scanner + signal-extractor | ⏳ Pending |
| 5 | Analyzer: evidence-collector + failure-runner | ⏳ Pending |
| 6 | Analyzer: comparator + repair-suggester | ⏳ Pending |
| 7 | Analyzer: verifier + report-builder | ⏳ Pending |
| 8 | Granite explainer | ✅ Done |
| 9 | Next.js API route | ⏳ Pending |
| 10 | Developer UI | ⏳ Pending |
| 11 | Testing pass | ⏳ Pending |
| 12 | Bob sessions + README finalization | ⏳ Pending |
