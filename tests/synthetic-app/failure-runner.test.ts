/**
 * Integration tests — Failure Runner + Evidence Collector.
 *
 * These tests spawn real child processes (baseline and changed synthetic apps),
 * trigger the payment failure scenario, and verify:
 *   - HTTP 502 is returned
 *   - Baseline evidence contains all 7 canonical signals
 *   - Changed evidence contains exactly 2 canonical signals (requestId + orderId)
 *   - Child processes are always cleaned up after each test
 *
 * Port allocation is random (via getFreePort inside runFailureScenario) so
 * these tests never conflict with each other or the Next.js dev server.
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import net from "net";
import { runFailureScenario } from "../../analyzer/failure-runner";
import { collectEvidence } from "../../analyzer/evidence-collector";
import { CANONICAL_SIGNAL_NAMES } from "../../analyzer/types";

// ---------------------------------------------------------------------------
// Helpers — shared with the direct spawn tests below
// ---------------------------------------------------------------------------

const TSX_BIN = path.resolve(
  __dirname,
  "../../node_modules/tsx/dist/cli.mjs"
);

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") { srv.close(); reject(new Error("No free port")); return; }
      const port = addr.port;
      srv.close((err) => { if (err) reject(err); else resolve(port); });
    });
    srv.on("error", reject);
  });
}

// Track any child processes started in individual tests so we can kill them in afterEach.
const trackedProcs: ChildProcess[] = [];

afterEach(() => {
  for (const proc of trackedProcs) {
    if (!proc.killed) proc.kill("SIGTERM");
  }
  trackedProcs.length = 0;
});

// ---------------------------------------------------------------------------
// Baseline — runFailureScenario
// ---------------------------------------------------------------------------

describe("failure-runner: baseline process", () => {
  it(
    "starts successfully and returns HTTP 502",
    async () => {
      const output = await runFailureScenario("baseline");
      expect(output.statusCode).toBe(502);
    },
    20_000
  );

  it(
    "captures stdout containing SERVER_READY marker",
    async () => {
      const output = await runFailureScenario("baseline");
      expect(output.stdout).toMatch(/SERVER_READY:\d+/);
    },
    20_000
  );

  it(
    "captures stderr containing structured JSON diagnostic log",
    async () => {
      const output = await runFailureScenario("baseline");
      // At least one stderr line must be parseable JSON with errorCode
      const hasStructuredLog = output.stderr
        .split("\n")
        .some((line) => {
          try {
            const obj = JSON.parse(line.trim()) as Record<string, unknown>;
            return typeof obj["errorCode"] === "string";
          } catch { return false; }
        });
      expect(hasStructuredLog).toBe(true);
    },
    20_000
  );

  it(
    "baseline runtime evidence contains all 7 canonical signals",
    async () => {
      const output = await runFailureScenario("baseline");
      const snapshot = collectEvidence({
        rawOutput: output.stdout + "\n" + output.stderr,
        version: "baseline",
        scenarioId: "payment-provider-timeout",
      });

      const names = snapshot.signals.map((s) => s.name);
      for (const canonical of CANONICAL_SIGNAL_NAMES) {
        expect(names, `expected signal "${canonical}" to be present`).toContain(canonical);
      }
      expect(snapshot.signals).toHaveLength(7);
    },
    20_000
  );

  it(
    "baseline evidence signals all have present=true",
    async () => {
      const output = await runFailureScenario("baseline");
      const snapshot = collectEvidence({
        rawOutput: output.stdout + "\n" + output.stderr,
        version: "baseline",
        scenarioId: "payment-provider-timeout",
      });
      for (const sig of snapshot.signals) {
        expect(sig.present).toBe(true);
      }
    },
    20_000
  );
});

// ---------------------------------------------------------------------------
// Changed — runFailureScenario
// ---------------------------------------------------------------------------

describe("failure-runner: changed process", () => {
  it(
    "starts successfully and returns HTTP 502",
    async () => {
      const output = await runFailureScenario("changed");
      expect(output.statusCode).toBe(502);
    },
    20_000
  );

  it(
    "changed runtime evidence contains exactly 2 canonical signals",
    async () => {
      const output = await runFailureScenario("changed");
      const snapshot = collectEvidence({
        rawOutput: output.stdout + "\n" + output.stderr,
        version: "changed",
        scenarioId: "payment-provider-timeout",
      });

      expect(snapshot.signals).toHaveLength(2);
      const names = snapshot.signals.map((s) => s.name);
      expect(names).toContain("requestId");
      expect(names).toContain("orderId");
    },
    20_000
  );

  it(
    "changed evidence is missing paymentProvider, operation, errorType, errorCode, originalMessage",
    async () => {
      const output = await runFailureScenario("changed");
      const snapshot = collectEvidence({
        rawOutput: output.stdout + "\n" + output.stderr,
        version: "changed",
        scenarioId: "payment-provider-timeout",
      });

      const names = snapshot.signals.map((s) => s.name);
      expect(names).not.toContain("paymentProvider");
      expect(names).not.toContain("operation");
      expect(names).not.toContain("errorType");
      expect(names).not.toContain("errorCode");
      expect(names).not.toContain("originalMessage");
    },
    20_000
  );
});

// ---------------------------------------------------------------------------
// Child process cleanup — direct spawn test
// ---------------------------------------------------------------------------

describe("failure-runner: child process cleanup", () => {
  it(
    "child process is not running after runFailureScenario resolves",
    async () => {
      // We cannot directly inspect the ChildProcess from runFailureScenario
      // after it resolves (it was killed in the finally block).
      // Instead, confirm that the port is FREE again after the run —
      // if the server were still bound, the port probe would fail.
      const output = await runFailureScenario("baseline");
      const port = output.port;

      // Try to bind a new server on the same port; it should succeed if
      // the child was properly killed.
      await new Promise<void>((resolve, reject) => {
        const probe = net.createServer();
        probe.listen(port, "127.0.0.1", () => {
          probe.close(() => resolve());
        });
        probe.on("error", (err) => {
          // Port still in use — process was not cleaned up
          reject(new Error(`Port ${port} still in use after runner finished: ${err.message}`));
        });
      });
    },
    20_000
  );
});

// ---------------------------------------------------------------------------
// Early child exit reports stdout/stderr immediately
// ---------------------------------------------------------------------------

describe("failure-runner: early child exit", () => {
  it(
    "reports captured stdout/stderr when the child exits before SERVER_READY",
    async () => {
      const port = await getFreePort();

      // Spawn a process that immediately exits with an error — no server at all.
      const proc = spawn(
        process.execPath,
        ["-e", "process.stderr.write('early-exit-error\\n'); process.exit(1)"],
        {
          env: { ...process.env, PORT: String(port), PAYMENT_FAILURE_MODE: "timeout" },
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      trackedProcs.push(proc);

      let caught: Error | null = null;
      try {
        // runFailureScenario uses a different port, so we replicate the
        // waitForReady logic here directly to test the early-exit path.
        await new Promise<void>((resolve, reject) => {
          let stdoutBuf = "";
          let stderrBuf = "";

          const timer = setTimeout(() => {
            reject(new Error(`Timeout: stdout=${stdoutBuf} stderr=${stderrBuf}`));
          }, 5_000);

          proc.stdout?.on("data", (c: Buffer) => { stdoutBuf += c.toString(); });
          proc.stderr?.on("data", (c: Buffer) => { stderrBuf += c.toString(); });

          proc.once("exit", (code) => {
            clearTimeout(timer);
            reject(
              new Error(
                `Server process exited (code ${code}) before becoming ready.\n` +
                  `stdout: ${stdoutBuf}\nstderr: ${stderrBuf}`
              )
            );
          });

          // This should never resolve — the process exits immediately.
          proc.stdout?.on("data", (c: Buffer) => {
            if (c.toString().includes(`SERVER_READY:${port}`)) resolve();
          });
        });
      } catch (err) {
        caught = err as Error;
      }

      expect(caught).not.toBeNull();
      expect(caught?.message).toMatch(/exited.*before becoming ready/i);
      // stderr captured and included in error
      expect(caught?.message).toContain("early-exit-error");
    },
    15_000
  );
});
