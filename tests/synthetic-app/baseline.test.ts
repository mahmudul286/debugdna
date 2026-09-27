/**
 * Integration test — Baseline synthetic app.
 *
 * Spawns the real server as a child process with PAYMENT_FAILURE_MODE=timeout,
 * sends POST /api/orders/:orderId/payment, confirms HTTP 502, captures the
 * structured stderr log, and verifies all 7 canonical diagnostic signals.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import http from "http";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_PORT = 3199; // isolated port — never collides with the Next.js app
const SERVER_ENTRY = path.resolve(__dirname, "../../synthetic-app/baseline/server.ts");

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
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Server on port ${port} did not emit SERVER_READY within ${timeoutMs}ms.\n` +
            `stdout: ${stdoutBuf}\nstderr: ${stderrBuf}`
        )
      );
    }, timeoutMs);

    let stdoutBuf = "";
    let stderrBuf = "";

    // Also buffer stderr so we can include it in the timeout error.
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

    // Fail immediately if the child exits before becoming ready.
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

  // Collect stdout lines (includes SERVER_READY marker + info logs).
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

describe("baseline synthetic app — payment failure (timeout mode)", () => {
  const ORDER_ID = "order-abc-123";
  let response: { statusCode: number; body: unknown };
  let diagnosticRecord: Record<string, unknown> | null = null;

  beforeAll(async () => {
    // Reset captured lines so only this request's log is examined.
    stderrLines = [];
    response = await postPayment(SERVER_PORT, ORDER_ID);

    // Give the process a tick to flush stderr.
    await new Promise((r) => setTimeout(r, 150));

    // Parse the first stderr line that contains canonical diagnostic fields.
    for (const line of stderrLines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed.errorCode !== undefined) {
          diagnosticRecord = parsed;
          break;
        }
      } catch {
        // not JSON — skip
      }
    }
  });

  it("returns HTTP 502", () => {
    expect(response.statusCode).toBe(502);
  });

  it("response body contains requestId", () => {
    const body = response.body as Record<string, unknown>;
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId).toBeTruthy();
  });

  it("response body contains errorCode", () => {
    const body = response.body as Record<string, unknown>;
    expect(body.errorCode).toBe("PROVIDER_TIMEOUT");
  });

  it("emits a structured JSON diagnostic log to stderr", () => {
    expect(diagnosticRecord).not.toBeNull();
  });

  // --- 7 canonical diagnostic signal assertions ---

  it("diagnostic log contains requestId", () => {
    expect(typeof diagnosticRecord?.requestId).toBe("string");
    expect(diagnosticRecord?.requestId).toBeTruthy();
  });

  it("diagnostic log contains orderId", () => {
    expect(diagnosticRecord?.orderId).toBe(ORDER_ID);
  });

  it("diagnostic log contains paymentProvider", () => {
    expect(typeof diagnosticRecord?.paymentProvider).toBe("string");
    expect(diagnosticRecord?.paymentProvider).toBeTruthy();
  });

  it("diagnostic log contains operation", () => {
    expect(diagnosticRecord?.operation).toBe("chargePayment");
  });

  it("diagnostic log contains errorType", () => {
    expect(diagnosticRecord?.errorType).toBe("PaymentError");
  });

  it("diagnostic log contains errorCode", () => {
    expect(diagnosticRecord?.errorCode).toBe("PROVIDER_TIMEOUT");
  });

  it("diagnostic log contains originalMessage", () => {
    expect(typeof diagnosticRecord?.originalMessage).toBe("string");
    expect(diagnosticRecord?.originalMessage).toBeTruthy();
  });
});
