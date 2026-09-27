/**
 * DebugDNA — Failure Runner.
 *
 * Starts a synthetic-app server as a real child process, injects a controlled
 * payment failure, captures all output, and returns structured runner output.
 *
 * Windows-safe process startup:
 *   spawn(process.execPath, [TSX_CLI_MJS, serverEntry], { env, stdio })
 *
 * Important:
 * - No shell:true
 * - No --import tsx/esm
 * - No shell-specific command strings
 * - Runtime paths are resolved from process.cwd()
 * - stdout/stderr are captured exactly once
 * - child processes are always cleaned up
 */

import { spawn, type ChildProcess } from "child_process";
import http from "http";
import net from "net";
import path from "path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Next.js can bundle analyzer modules into .next/server.
 * Therefore __dirname must NOT be used to locate project files.
 *
 * process.cwd() points to the project root when the app is started with:
 * - npm run dev
 * - npm start
 * - next start
 */
const PROJECT_ROOT = process.cwd();

/**
 * Direct tsx CLI entry point.
 *
 * This avoids:
 * - Windows .cmd shims
 * - shell lookup
 * - --import tsx/esm
 */
const TSX_BIN = path.join(
  PROJECT_ROOT,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);

/**
 * Root directory containing the synthetic demo applications.
 */
const SYNTHETIC_APP_ROOT = path.join(
  PROJECT_ROOT,
  "synthetic-app",
);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AppVersion = "baseline" | "changed";

export interface RunnerOutput {
  /** HTTP status returned by the payment endpoint. */
  statusCode: number;

  /** Parsed response body, or raw text when JSON parsing fails. */
  responseBody: unknown;

  /** All stdout captured from the child process. */
  stdout: string;

  /** All stderr captured from the child process. */
  stderr: string;

  /** Port used by the child process. */
  port: number;
}

// ---------------------------------------------------------------------------
// Helpers — random free port
// ---------------------------------------------------------------------------

/**
 * Find an available localhost port.
 *
 * The port is briefly reserved by this helper and then released.
 * The actual child process binds it immediately afterwards.
 */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      server.removeAllListeners();
      reject(error);
    });

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

        server.close((error) => {
          server.removeAllListeners();

          if (error) {
            reject(error);
            return;
          }

          resolve(port);
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Helpers — wait for SERVER_READY marker
// ---------------------------------------------------------------------------

/**
 * Wait until the already-captured stdout contains:
 *
 *   SERVER_READY:<port>
 *
 * IMPORTANT:
 * This function does NOT attach another stdout data listener that appends
 * to stdoutAcc. stdout is captured exactly once in runFailureScenario().
 */
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
      clearInterval(pollTimer);

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

    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      fail(
        new Error(
          [
            "Server process exited before becoming ready.",
            `code: ${code ?? "null"}`,
            `signal: ${signal ?? "none"}`,
            `stdout: ${stdoutAcc.value}`,
            `stderr: ${stderrAcc.value}`,
          ].join("\n"),
        ),
      );
    };

    const onError = (error: Error) => {
      fail(
        new Error(
          [
            `Failed to start server: ${error.message}`,
            `stdout: ${stdoutAcc.value}`,
            `stderr: ${stderrAcc.value}`,
          ].join("\n"),
        ),
      );
    };

    const timer = setTimeout(() => {
      fail(
        new Error(
          [
            `Server on port ${port} did not emit ${marker} within ${timeoutMs}ms.`,
            `stdout: ${stdoutAcc.value}`,
            `stderr: ${stderrAcc.value}`,
          ].join("\n"),
        ),
      );
    }, timeoutMs);

    /**
     * Poll only the accumulator.
     *
     * This avoids registering a second stdout listener and therefore prevents
     * duplicate log lines in the captured output.
     */
    const pollTimer = setInterval(() => {
      if (stdoutAcc.value.includes(marker)) {
        succeed();
      }
    }, 25);

    proc.once("exit", onExit);
    proc.once("error", onError);

    // Handle the case where the marker was already captured before setup.
    if (stdoutAcc.value.includes(marker)) {
      succeed();
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers — HTTP POST
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
    const data = JSON.stringify({});

    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path: `/api/orders/${encodeURIComponent(
        orderId,
      )}/payment`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
      timeout: timeoutMs,
    };

    const request = http.request(
      options,
      (response) => {
        let raw = "";

        response.setEncoding("utf8");

        response.on(
          "data",
          (chunk: string) => {
            raw += chunk;
          },
        );

        response.on("end", () => {
          let body: unknown;

          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
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
          `HTTP request to port ${port} timed out after ${timeoutMs}ms.`,
        ),
      );
    });

    request.on("error", reject);

    request.write(data);
    request.end();
  });
}

// ---------------------------------------------------------------------------
// Public API — runFailureScenario
// ---------------------------------------------------------------------------

/**
 * Start the specified synthetic-app version as a real child process,
 * trigger the controlled payment failure, capture runtime output,
 * and return structured results.
 *
 * The child process is always terminated in a finally block.
 */
export async function runFailureScenario(
  version: AppVersion,
  orderId = "demo-order",
): Promise<RunnerOutput> {
  // -------------------------------------------------------------------------
  // 1. Validate the requested version.
  // -------------------------------------------------------------------------

  if (
    version !== "baseline" &&
    version !== "changed"
  ) {
    throw new Error(
      `Unsupported synthetic app version: ${String(version)}`,
    );
  }

  // -------------------------------------------------------------------------
  // 2. Resolve runtime paths from project root.
  // -------------------------------------------------------------------------

  const port = await getFreePort();

  const serverEntry = path.join(
    SYNTHETIC_APP_ROOT,
    version,
    "server.ts",
  );

  // -------------------------------------------------------------------------
  // 3. Capture buffers.
  //
  // These are the ONLY stdout/stderr accumulators.
  // -------------------------------------------------------------------------

  const stdoutAcc = {
    value: "",
  };

  const stderrAcc = {
    value: "",
  };

  // -------------------------------------------------------------------------
  // 4. Start child process.
  // -------------------------------------------------------------------------

  const proc = spawn(
    process.execPath,
    [
      TSX_BIN,
      serverEntry,
    ],
    {
      env: {
        ...process.env,
        PORT: String(port),
        PAYMENT_FAILURE_MODE: "timeout",
      },

      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],

      windowsHide: true,
    },
  );

  // -------------------------------------------------------------------------
  // 5. Capture stdout exactly once.
  // -------------------------------------------------------------------------

  proc.stdout?.on(
    "data",
    (chunk: Buffer) => {
      stdoutAcc.value += chunk.toString();
    },
  );

  // -------------------------------------------------------------------------
  // 6. Capture stderr exactly once.
  // -------------------------------------------------------------------------

  proc.stderr?.on(
    "data",
    (chunk: Buffer) => {
      stderrAcc.value += chunk.toString();
    },
  );

  try {
    // -----------------------------------------------------------------------
    // 7. Wait for deterministic server readiness.
    // -----------------------------------------------------------------------

    await waitForReady(
      proc,
      port,
      stdoutAcc,
      stderrAcc,
    );

    // -----------------------------------------------------------------------
    // 8. Trigger the controlled payment failure.
    // -----------------------------------------------------------------------

    const {
      statusCode,
      body,
    } = await postPayment(
      port,
      orderId,
    );

    // -----------------------------------------------------------------------
    // 9. Functional assertion.
    // -----------------------------------------------------------------------

    if (statusCode !== 502) {
      throw new Error(
        [
          `Expected HTTP 502 from ${version} server, received HTTP ${statusCode}.`,
          `response: ${JSON.stringify(body)}`,
          `stdout: ${stdoutAcc.value}`,
          `stderr: ${stderrAcc.value}`,
        ].join("\n"),
      );
    }

    // -----------------------------------------------------------------------
    // 10. Allow the logger a short amount of time to flush.
    // -----------------------------------------------------------------------

    await new Promise<void>(
      (resolve) => {
        setTimeout(resolve, 200);
      },
    );

    // -----------------------------------------------------------------------
    // 11. Return captured runtime evidence.
    // -----------------------------------------------------------------------

    return {
      statusCode,
      responseBody: body,
      stdout: stdoutAcc.value,
      stderr: stderrAcc.value,
      port,
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