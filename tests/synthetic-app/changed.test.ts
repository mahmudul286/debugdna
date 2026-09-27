/**
 * Integration test — Changed synthetic app.
 *
 * Spawns the real changed server as a child process with
 * PAYMENT_FAILURE_MODE=timeout, sends POST /api/orders/:orderId/payment,
 * and verifies:
 *   - HTTP 502 is returned (functional parity)
 *   - requestId and orderId ARE present in the stderr diagnostic log
 *   - paymentProvider, operation, errorType, errorCode, and originalMessage
 *     are ABSENT from the stderr diagnostic log (intentional degradation)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import http from "http";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_PORT = 3198; // isolated port — never collides with other servers
const SERVER_ENTRY = path.resolve(__dirname, "../../synthetic-app/changed/server.ts");

// Resolve tsx via node_modules/.bin — use the .cmd shim on Windows so the
// OS can locate it without requiring shell:true.
const TSX_BIN = path.resolve(
  __dirname,
  "../../node_modules/tsx/dist/cli.mjs"
);

// ---------------------------------------------------------------------------
// waitForServer — waits for SERVER_READY:<port> on stdout
// ---------------------------------------------------------------------------

function waitForServer(
  proc: ChildProcess,
  port: number,
  timeoutMs = 10_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdoutBuf = "";
    let stderrBuf = "";

    const timer = setTimeout(() => {
      reject(
        new Error(
          `Server on port ${port} did not emit SERVER_READY within ${timeoutMs}ms.\n` +
            `stdout: ${stdoutBuf}\nstderr: ${stderrBuf}`
        )
      );
    }, timeoutMs);

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      if (stdoutBuf.includes(`SERVER_READY:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });

    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Server process exited (code ${code}) before becoming ready.\n` +
            `stdout: ${stdoutBuf}\nstderr: ${stderrBuf}`
        )
      );
    });
  });
}

// ---------------------------------------------------------------------------
// postPayment
// ---------------------------------------------------------------------------

function postPayment(
  port: number,
  orderId: string
): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({});
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path: `/api/orders/${orderId}/payment`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = http.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
        resolve({ statusCode: res.statusCode ?? 0, body });
      });
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let serverProcess: ChildProcess;
let stdoutLines: string[] = [];
let stderrLines: string[] = [];

beforeAll(async () => {
  serverProcess = spawn(
    process.execPath, // absolute path to the current node binary
    [TSX_BIN, SERVER_ENTRY], // node <tsx cli.mjs> <server.ts>
    {
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        PAYMENT_FAILURE_MODE: "timeout",
      },
      // No shell:true needed — node is an executable, tsx/cli.mjs is a JS file.
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  // Collect stdout lines.
  serverProcess.stdout?.on("data", (chunk: Buffer) => {
    const lines = chunk
      .toString()
      .split("\n")
      .filter((l) => l.trim().length > 0);
    stdoutLines.push(...lines);
  });

  // Collect stderr lines (structured diagnostic logs).
  serverProcess.stderr?.on("data", (chunk: Buffer) => {
    const lines = chunk
      .toString()
      .split("\n")
      .filter((l) => l.trim().length > 0);
    stderrLines.push(...lines);
  });

  await waitForServer(serverProcess, SERVER_PORT);
}, 15_000);

afterAll(() => {
  serverProcess?.kill("SIGTERM");
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("changed synthetic app — payment failure (timeout mode)", () => {
  const ORDER_ID = "order-xyz-456";
  let response: { statusCode: number; body: unknown };
  let diagnosticRecord: Record<string, unknown> | null = null;

  beforeAll(async () => {
    // Reset captured lines so only this request's log is examined.
    stderrLines = [];
    response = await postPayment(SERVER_PORT, ORDER_ID);

    // Give the process a tick to flush stderr.
    await new Promise((r) => setTimeout(r, 150));

    // Parse the first stderr line that is a JSON object (the diagnostic log).
    for (const line of stderrLines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        // The degraded log contains requestId and orderId but not errorCode.
        // Match the first log that has requestId (the payment failure log).
        if (parsed.requestId !== undefined) {
          diagnosticRecord = parsed;
          break;
        }
      } catch {
        // not JSON — skip
      }
    }
  });

  // --- Functional parity ---

  it("returns HTTP 502 (functional failure still occurs)", () => {
    expect(response.statusCode).toBe(502);
  });

  it("response body contains generic error message", () => {
    const body = response.body as Record<string, unknown>;
    expect(body.error).toBe("Payment failed");
  });

  it("emits a structured JSON diagnostic log to stderr", () => {
    expect(diagnosticRecord).not.toBeNull();
  });

  // --- Preserved diagnostic signals (must be present) ---

  it("diagnostic log contains requestId", () => {
    expect(typeof diagnosticRecord?.requestId).toBe("string");
    expect(diagnosticRecord?.requestId).toBeTruthy();
  });

  it("diagnostic log contains orderId", () => {
    expect(diagnosticRecord?.orderId).toBe(ORDER_ID);
  });

  // --- Degraded response (absent fields) ---

  it("response body does NOT contain requestId", () => {
    const body = response.body as Record<string, unknown>;
    expect(body.requestId).toBeUndefined();
  });

  it("response body does NOT contain errorCode", () => {
    const body = response.body as Record<string, unknown>;
    expect(body.errorCode).toBeUndefined();
  });

  // --- Intentionally removed diagnostic signals (must be absent) ---

  it("diagnostic log does NOT contain paymentProvider", () => {
    expect(diagnosticRecord?.paymentProvider).toBeUndefined();
  });

  it("diagnostic log does NOT contain operation", () => {
    expect(diagnosticRecord?.operation).toBeUndefined();
  });

  it("diagnostic log does NOT contain errorType", () => {
    expect(diagnosticRecord?.errorType).toBeUndefined();
  });

  it("diagnostic log does NOT contain errorCode", () => {
    expect(diagnosticRecord?.errorCode).toBeUndefined();
  });

  it("diagnostic log does NOT contain originalMessage", () => {
    expect(diagnosticRecord?.originalMessage).toBeUndefined();
  });
});
