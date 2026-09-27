/**
 * DebugDNA — Verifier.
 *
 * Applies a RepairSuggestion deterministically to the changed source,
 * writes the repaired application to synthetic-app/repaired/,
 * starts the repaired application as a real child process,
 * triggers the same controlled failure scenario,
 * captures real runtime evidence,
 * and verifies every previously-lost diagnostic signal.
 *
 * Important rules:
 * - No baseline source file is read at runtime.
 * - No shell diff tool is used.
 * - No fake EvidenceSnapshot is generated.
 * - Repair is deterministic and derived from the lost-signal set.
 * - Verification uses actual runtime output.
 * - Every child process is cleaned up.
 * - Timestamp is metadata, not a diagnostic signal.
 */

import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import http from "http";
import net from "net";

import { collectEvidence } from "./evidence-collector";

import type {
  ComparisonResult,
  DiagnosticSignal,
  EvidenceSnapshot,
  FailureScenario,
  RepairSuggestion,
  VerificationResult,
} from "./types";

// ---------------------------------------------------------------------------
// Project paths
// ---------------------------------------------------------------------------

/**
 * IMPORTANT:
 *
 * When this module is imported by a Next.js API route, __dirname may point
 * somewhere inside .next/server/...
 *
 * The real synthetic-app and node_modules directories live at the project
 * root, so runtime paths must be resolved from process.cwd().
 */
const PROJECT_ROOT = process.cwd();

/**
 * Absolute path to the tsx CLI entry point.
 *
 * Using cli.mjs directly avoids:
 * - shell lookup
 * - .cmd shims
 * - --import tsx/esm
 */
const TSX_BIN = path.join(
  PROJECT_ROOT,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);

const SYNTHETIC_APP_ROOT = path.join(
  PROJECT_ROOT,
  "synthetic-app",
);

const REPAIRED_DIR = path.join(
  SYNTHETIC_APP_ROOT,
  "repaired",
);

const REPAIRED_SERVER = path.join(
  REPAIRED_DIR,
  "server.ts",
);

// ---------------------------------------------------------------------------
// Canonical signals
// ---------------------------------------------------------------------------

const CANONICAL_SIGNAL_ORDER = [
  "requestId",
  "orderId",
  "paymentProvider",
  "operation",
  "errorType",
  "errorCode",
  "originalMessage",
] as const;

type CanonicalSignalName =
  (typeof CANONICAL_SIGNAL_ORDER)[number];

/**
 * These are the exact source fragments used by the synthetic demo.
 *
 * The repair is derived from the lost-signal set and this mapping.
 * It does NOT read the baseline source file.
 */
const SIGNAL_SOURCE_MAP: Record<
  CanonicalSignalName,
  string
> = {
  requestId: "requestId",
  orderId: "orderId",
  paymentProvider:
    "paymentProvider: err.provider",
  operation:
    'operation: "chargePayment"',
  errorType:
    "errorType: err.name",
  errorCode:
    "errorCode: err.code",
  originalMessage:
    "originalMessage: err.originalMessage",
};

// ---------------------------------------------------------------------------
// Internal helpers — random port
// ---------------------------------------------------------------------------

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    const onError = (error: Error) => {
      server.removeAllListeners();
      reject(error);
    };

    server.once("error", onError);

    server.listen(
      0,
      "127.0.0.1",
      () => {
        const address = server.address();

        if (
          !address ||
          typeof address === "string"
        ) {
          server.close();
          server.removeAllListeners();
          reject(
            new Error(
              "Could not determine a free localhost port.",
            ),
          );
          return;
        }

        const port = address.port;

        server.close((closeError) => {
          server.removeAllListeners();

          if (closeError) {
            reject(closeError);
            return;
          }

          resolve(port);
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Internal helper — wait for readiness
// ---------------------------------------------------------------------------

function waitForReady(
  proc: ChildProcess,
  port: number,
  stdoutAcc: { value: string },
  stderrAcc: { value: string },
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const marker = `SERVER_READY:${port}`;

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout?.off("data", onStdout);
      proc.off("exit", onExit);
      proc.off("error", onError);
    };

    const succeed = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve();
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const onStdout = () => {
      if (stdoutAcc.value.includes(marker)) {
        succeed();
      }
    };

    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      fail(
        new Error(
          [
            "Repaired server exited before becoming ready.",
            `code=${code ?? "null"}`,
            `signal=${signal ?? "none"}`,
            `stdout=${stdoutAcc.value}`,
            `stderr=${stderrAcc.value}`,
          ].join("\n"),
        ),
      );
    };

    const onError = (error: Error) => {
      fail(
        new Error(
          [
            `Failed to start repaired server: ${error.message}`,
            `stdout=${stdoutAcc.value}`,
            `stderr=${stderrAcc.value}`,
          ].join("\n"),
        ),
      );
    };

    const timer = setTimeout(() => {
      fail(
        new Error(
          [
            `Repaired server did not emit ${marker} within ${timeoutMs}ms.`,
            `stdout=${stdoutAcc.value}`,
            `stderr=${stderrAcc.value}`,
          ].join("\n"),
        ),
      );
    }, timeoutMs);

    proc.stdout?.on("data", onStdout);
    proc.once("exit", onExit);
    proc.once("error", onError);

    // The marker may already have arrived before listeners were attached.
    if (stdoutAcc.value.includes(marker)) {
      succeed();
    }
  });
}

// ---------------------------------------------------------------------------
// Internal helper — HTTP payment request
// ---------------------------------------------------------------------------

function postPayment(
  port: number,
  orderId: string,
  timeoutMs = 15_000,
): Promise<{
  statusCode: number;
  body: unknown;
}> {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({});

    const requestOptions: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path: `/api/orders/${encodeURIComponent(
        orderId,
      )}/payment`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(
          requestBody,
        ),
      },
      timeout: timeoutMs,
    };

    const request = http.request(
      requestOptions,
      (response) => {
        let rawBody = "";

        response.setEncoding("utf8");

        response.on(
          "data",
          (chunk: string) => {
            rawBody += chunk;
          },
        );

        response.on("end", () => {
          let body: unknown;

          try {
            body = JSON.parse(rawBody);
          } catch {
            body = rawBody;
          }

          resolve({
            statusCode:
              response.statusCode ?? 0,
            body,
          });
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(
        new Error(
          `HTTP request to repaired server timed out after ${timeoutMs}ms.`,
        ),
      );
    });

    request.on("error", reject);

    request.write(requestBody);
    request.end();
  });
}

// ---------------------------------------------------------------------------
// Internal helper — find degraded logger call
// ---------------------------------------------------------------------------

interface LoggerCallRange {
  start: number;
  end: number;
  text: string;
}

/**
 * Finds the first logger.error({...}) call that is missing all five
 * extended diagnostic signals.
 *
 * This intentionally targets the degraded payment-failure logging call.
 */
function findDegradedLoggerCall(
  source: string,
): LoggerCallRange | null {
  const startRegex =
    /logger\.error\(\s*\{/g;

  let match: RegExpExecArray | null;

  while (
    (match = startRegex.exec(source)) !== null
  ) {
    const openParen = source.indexOf(
      "(",
      match.index,
    );

    if (openParen === -1) {
      continue;
    }

    let depth = 0;
    let closeIndex = -1;

    for (
      let index = openParen;
      index < source.length;
      index += 1
    ) {
      const char = source[index];

      if (
        char === "(" ||
        char === "{"
      ) {
        depth += 1;
      } else if (
        char === ")" ||
        char === "}"
      ) {
        depth -= 1;

        if (depth === 0) {
          closeIndex = index;
          break;
        }
      }
    }

    if (closeIndex === -1) {
      continue;
    }

    const callText = source.slice(
      match.index,
      closeIndex + 1,
    );

    const extendedSignals = [
      "paymentProvider",
      "operation",
      "errorType",
      "errorCode",
      "originalMessage",
    ];

    const isDegraded =
      !extendedSignals.some(
        (signal) =>
          callText.includes(signal),
      );

    if (!isDegraded) {
      continue;
    }

    return {
      start: match.index,
      end: closeIndex + 1,
      text: callText,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// applyRepair — pure deterministic transformation
// ---------------------------------------------------------------------------

/**
 * Applies the repair without reading baseline source.
 *
 * The final logger call is reconstructed from:
 * - preserved canonical signals
 * - signals explicitly present in suggestion.signalMappings
 * - the approved canonical source mapping
 *
 * Only signals belonging to the comparison are restored.
 */
export function applyRepair(
  changedSource: string,
  suggestion: RepairSuggestion,
  comparison: ComparisonResult,
): string {
  if (!changedSource.trim()) {
    throw new Error(
      "verifier.applyRepair: changed source is empty.",
    );
  }

  if (
    !suggestion.signalMappings ||
    Object.keys(
      suggestion.signalMappings,
    ).length === 0
  ) {
    throw new Error(
      "verifier.applyRepair: repair suggestion contains no signal mappings.",
    );
  }

  if (
    comparison.lostSignals.length === 0
  ) {
    throw new Error(
      "verifier.applyRepair: comparison contains no lost signals.",
    );
  }

  // -------------------------------------------------------------------------
  // Validate that every lost signal has a mapping.
  // -------------------------------------------------------------------------

  for (const lostSignal of comparison.lostSignals) {
    const name =
      lostSignal.name as CanonicalSignalName;

    if (
      !CANONICAL_SIGNAL_ORDER.includes(name)
    ) {
      throw new Error(
        `verifier.applyRepair: unsupported lost signal "${lostSignal.name}".`,
      );
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        suggestion.signalMappings,
        name,
      )
    ) {
      throw new Error(
        `verifier.applyRepair: missing repair mapping for lost signal "${name}".`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Locate degraded logger call.
  // -------------------------------------------------------------------------

  const loggerCall =
    findDegradedLoggerCall(changedSource);

  if (!loggerCall) {
    throw new Error(
      "verifier.applyRepair: could not locate the degraded logger.error call.",
    );
  }

  const lostNames = new Set(
    comparison.lostSignals.map(
      (signal) => signal.name,
    ),
  );

  /**
   * Preserved signals remain in the repaired logger.
   *
   * In the current demo these are requestId and orderId.
   */
  const preservedNames = new Set(
    comparison.preservedSignals.map(
      (signal) => signal.name,
    ),
  );

  const allowedNames = new Set<string>([
    ...preservedNames,
    ...lostNames,
  ]);

  // -------------------------------------------------------------------------
  // Reconstruct logger call.
  // -------------------------------------------------------------------------

  const fragments: string[] = [];

  for (const signalName of CANONICAL_SIGNAL_ORDER) {
    if (!allowedNames.has(signalName)) {
      continue;
    }

    const canonicalName =
      signalName as CanonicalSignalName;

    fragments.push(
      `        ${SIGNAL_SOURCE_MAP[canonicalName]}`,
    );
  }

  if (fragments.length === 0) {
    throw new Error(
      "verifier.applyRepair: no valid canonical diagnostic signals remain.",
    );
  }

  const repairedLoggerCall = [
    "logger.error({",
    fragments.join(",\n"),
    ",",
    "      })",
  ].join("\n");

  let repairedSource =
    changedSource.slice(
      0,
      loggerCall.start,
    ) +
    repairedLoggerCall +
    changedSource.slice(
      loggerCall.end,
    );

  // -------------------------------------------------------------------------
  // Restore original HTTP error response behavior.
  //
  // The changed demo intentionally contains:
  //     next(new Error("Payment failed"))
  //
  // We restore the response behavior directly instead of throwing from an
  // async Express 4 handler.
  // -------------------------------------------------------------------------

  const degradedPropagationPatterns = [
    'next(new Error("Payment failed"))',
    'return next(new Error("Payment failed"))',
  ];

  const fixedPropagation =
    "res.status(502).json({ requestId, errorCode: err.code })";

  let propagationFixed = false;

  for (const degradedPattern of degradedPropagationPatterns) {
    if (repairedSource.includes(degradedPattern)) {
      repairedSource =
        repairedSource.replace(
          degradedPattern,
          fixedPropagation,
        );

      propagationFixed = true;
      break;
    }
  }

  /**
   * errorCode is one of the five intentionally-lost signals and therefore the
   * demo repair should contain the response-level errorCode as well.
   *
   * If the expected degraded pattern is missing, fail clearly rather than
   * silently pretending the propagation repair happened.
   */
  const errorCodeWasLost =
    lostNames.has("errorCode");

  if (
    errorCodeWasLost &&
    !propagationFixed
  ) {
    throw new Error(
      "verifier.applyRepair: expected degraded PaymentError propagation pattern was not found.",
    );
  }

  return repairedSource;
}

// ---------------------------------------------------------------------------
// Verifier public input
// ---------------------------------------------------------------------------

export interface VerifierInput {
  /** Full source text of synthetic-app/changed/server.ts. */
  changedSource: string;

  /** Deterministic repair generated by repair-suggester.ts. */
  suggestion: RepairSuggestion;

  /** Comparison that identified the lost signals. */
  comparison: ComparisonResult;

  /** Same failure scenario used for baseline/changed analysis. */
  scenario: FailureScenario;

  /** Demo order ID. */
  orderId?: string;
}

// ---------------------------------------------------------------------------
// verifyRepair
// ---------------------------------------------------------------------------

/**
 * Applies the repair, runs the repaired server for real, captures actual
 * runtime evidence, and verifies individual diagnostic signal restoration.
 */
export async function verifyRepair(
  input: VerifierInput,
): Promise<VerificationResult> {
  const {
    changedSource,
    suggestion,
    comparison,
    scenario,
    orderId = "demo-order",
  } = input;

  const lostSignals =
    comparison.lostSignals;

  if (
    lostSignals.length === 0
  ) {
    throw new Error(
      "verifier.verifyRepair: no lost signals were supplied.",
    );
  }

  // -------------------------------------------------------------------------
  // 1. Apply deterministic repair.
  // -------------------------------------------------------------------------

  const repairedSource =
    applyRepair(
      changedSource,
      suggestion,
      comparison,
    );

  // -------------------------------------------------------------------------
  // 2. Prepare fresh repaired directory.
  // -------------------------------------------------------------------------

  fs.rmSync(
    REPAIRED_DIR,
    {
      recursive: true,
      force: true,
    },
  );

  fs.mkdirSync(
    REPAIRED_DIR,
    {
      recursive: true,
    },
  );

  // -------------------------------------------------------------------------
  // 3. Write repaired server.
  // -------------------------------------------------------------------------

  fs.writeFileSync(
    REPAIRED_SERVER,
    repairedSource,
    "utf8",
  );

  // -------------------------------------------------------------------------
  // 4. Copy unchanged support files.
  // -------------------------------------------------------------------------

  const changedDir = path.join(
    SYNTHETIC_APP_ROOT,
    "changed",
  );

  for (const dependency of [
    "payment-provider.ts",
    "logger.ts",
  ]) {
    const source = path.join(
      changedDir,
      dependency,
    );

    const destination = path.join(
      REPAIRED_DIR,
      dependency,
    );

    if (!fs.existsSync(source)) {
      throw new Error(
        `verifier.verifyRepair: required dependency does not exist: ${source}`,
      );
    }

    fs.copyFileSync(
      source,
      destination,
    );
  }

  // -------------------------------------------------------------------------
  // 5. Start repaired server.
  // -------------------------------------------------------------------------

  const port = await getFreePort();

  const stdoutAcc = {
    value: "",
  };

  const stderrAcc = {
    value: "",
  };

  const failureMode =
    scenario.injectedCondition ===
    "service-error"
      ? "service-error"
      : "timeout";

  const proc = spawn(
    process.execPath,
    [
      TSX_BIN,
      REPAIRED_SERVER,
    ],
    {
      env: {
        ...process.env,
        PORT: String(port),
        PAYMENT_FAILURE_MODE:
          failureMode,
      },
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
      windowsHide: true,
    },
  );

  // Capture stdout exactly once.
  proc.stdout?.on(
    "data",
    (chunk: Buffer) => {
      stdoutAcc.value +=
        chunk.toString();
    },
  );

  // Capture stderr exactly once.
  proc.stderr?.on(
    "data",
    (chunk: Buffer) => {
      stderrAcc.value +=
        chunk.toString();
    },
  );

  try {
    // -----------------------------------------------------------------------
    // 6. Wait for real server readiness.
    // -----------------------------------------------------------------------

    await waitForReady(
      proc,
      port,
      stdoutAcc,
      stderrAcc,
    );

    // -----------------------------------------------------------------------
    // 7. Trigger the SAME failure scenario.
    // -----------------------------------------------------------------------

    const {
      statusCode,
      body,
    } = await postPayment(
      port,
      orderId,
    );

    // Functional behavior must remain unchanged.
    if (statusCode !== 502) {
      throw new Error(
        [
          "Repaired application did not preserve the expected failure behavior.",
          `Expected HTTP 502, received HTTP ${statusCode}.`,
          `response=${JSON.stringify(body)}`,
          `stdout=${stdoutAcc.value}`,
          `stderr=${stderrAcc.value}`,
        ].join("\n"),
      );
    }

    // -----------------------------------------------------------------------
    // 8. Allow diagnostic output to flush.
    // -----------------------------------------------------------------------

    await new Promise<void>(
      (resolve) => {
        setTimeout(resolve, 200);
      },
    );

    // -----------------------------------------------------------------------
    // 9. Collect ACTUAL repaired runtime evidence.
    // -----------------------------------------------------------------------

    const repaired: EvidenceSnapshot =
      collectEvidence({
        rawOutput:
          stdoutAcc.value +
          "\n" +
          stderrAcc.value,
        version: "repaired",
        scenarioId: scenario.id,
        sourceFile:
          "repaired/server.ts",
      });

    // -----------------------------------------------------------------------
    // 10. Verify every individual lost signal.
    // -----------------------------------------------------------------------

    const repairedNames =
      new Set(
        repaired.signals.map(
          (signal) => signal.name,
        ),
      );

    const restoredSignals: DiagnosticSignal[] =
      [];

    const stillMissing: DiagnosticSignal[] =
      [];

    for (const lostSignal of lostSignals) {
      const restored =
        repairedNames.has(
          lostSignal.name,
        );

      if (restored) {
        const actualSignal =
          repaired.signals.find(
            (signal) =>
              signal.name ===
              lostSignal.name,
          );

        restoredSignals.push(
          actualSignal ?? {
            ...lostSignal,
            present: true,
          },
        );
      } else {
        stillMissing.push(
          lostSignal,
        );
      }
    }

    // -----------------------------------------------------------------------
    // 11. Final verification result.
    //
    // Do NOT compare only counts.
    // Every individual lost signal must return.
    // -----------------------------------------------------------------------

    const restored =
      stillMissing.length === 0;

    return {
      restored,
      restoredSignals,
      stillMissing,
      repaired,
    };
  } finally {
    // -----------------------------------------------------------------------
    // 12. Always terminate the child process.
    // -----------------------------------------------------------------------

    if (
      !proc.killed &&
      proc.exitCode === null &&
      proc.signalCode === null
    ) {
      proc.kill("SIGTERM");
    }
  }
}