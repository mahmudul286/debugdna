/**
 * Unit tests for analyzer/granite-explainer.ts
 *
 * All tests use mocked fetch — no real network calls are made.
 *
 * Tested behaviors:
 * 1. No WATSONX_API_KEY → returns undefined (no throw, no log)
 * 2. Valid mocked API response → returns the explanation string
 * 3. Prompt contains only supplied deterministic evidence
 * 4. Prompt explicitly forbids new findings, severity changes, and invented facts
 * 5. Model ID comes from WATSONX_MODEL_ID env var (falls back to default)
 * 6. API failure (non-2xx) → graceful undefined result
 * 7. Network error (fetch throws) → graceful undefined result
 * 8. Granite output never affects deterministic fields (graniteExplanation is additive only)
 * 9. Empty Granite response → returns undefined (not an empty string)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { explainWithGranite, buildPrompt } from "@/analyzer/granite-explainer";
import type { GraniteExplainerInput } from "@/analyzer/granite-explainer";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const DEMO_INPUT: GraniteExplainerInput = {
  scenario: { description: "Payment provider timeout scenario" },
  severity: "high",
  lostSignalNames: ["paymentProvider", "operation", "errorType", "errorCode", "originalMessage"],
  preservedSignalNames: ["requestId", "orderId"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function makeWatsonxBody(text: string) {
  return { results: [{ generated_text: text }] };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const originalEnv = { ...process.env };

beforeEach(() => {
  // Reset env to a clean state before each test.
  delete process.env.WATSONX_API_KEY;
  delete process.env.WATSONX_PROJECT_ID;
  delete process.env.WATSONX_MODEL_ID;
  delete process.env.WATSONX_REGION;
  // Restore global fetch to its unset state so each test controls it explicitly.
  vi.restoreAllMocks();
});

afterEach(() => {
  // Restore original env after each test.
  Object.assign(process.env, originalEnv);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. No API key → undefined
// ---------------------------------------------------------------------------

describe("explainWithGranite — no WATSONX_API_KEY", () => {
  it("returns undefined when WATSONX_API_KEY is not set", async () => {
    const result = await explainWithGranite(DEMO_INPUT);
    expect(result).toBeUndefined();
  });

  it("does not call fetch when WATSONX_API_KEY is not set", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    await explainWithGranite(DEMO_INPUT);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Valid mocked API response → explanation string returned
// ---------------------------------------------------------------------------

describe("explainWithGranite — successful API response", () => {
  it("returns the generated text from a valid API response", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";
    process.env.WATSONX_PROJECT_ID = "test-project-id";

    const expectedExplanation =
      "Removing these five diagnostic signals leaves an engineer without context about what payment provider was involved, what operation was attempted, and what error occurred. This makes it significantly harder to reproduce and diagnose failures in production. The repair restores all five signals to their original positions.";

    vi.stubGlobal("fetch", makeMockFetch(200, makeWatsonxBody(expectedExplanation)));

    const result = await explainWithGranite(DEMO_INPUT);
    expect(result).toBe(expectedExplanation);
  });

  it("trims whitespace from the generated text", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";

    vi.stubGlobal(
      "fetch",
      makeMockFetch(200, makeWatsonxBody("  explanation with surrounding spaces  "))
    );

    const result = await explainWithGranite(DEMO_INPUT);
    expect(result).toBe("explanation with surrounding spaces");
  });
});

// ---------------------------------------------------------------------------
// 3. Prompt contains only supplied deterministic evidence
// ---------------------------------------------------------------------------

describe("buildPrompt — deterministic evidence only", () => {
  it("includes the scenario description", () => {
    const prompt = buildPrompt(DEMO_INPUT);
    expect(prompt).toContain(DEMO_INPUT.scenario.description);
  });

  it("includes the severity level", () => {
    const prompt = buildPrompt(DEMO_INPUT);
    expect(prompt).toContain("high");
  });

  it("includes each lost signal name", () => {
    const prompt = buildPrompt(DEMO_INPUT);
    for (const name of DEMO_INPUT.lostSignalNames) {
      expect(prompt).toContain(name);
    }
  });

  it("includes each preserved signal name", () => {
    const prompt = buildPrompt(DEMO_INPUT);
    for (const name of DEMO_INPUT.preservedSignalNames) {
      expect(prompt).toContain(name);
    }
  });

  it("asks for 3–5 sentences", () => {
    const prompt = buildPrompt(DEMO_INPUT);
    expect(prompt).toContain("3–5 sentences");
  });

  it("specifies 150-word maximum output", () => {
    const prompt = buildPrompt(DEMO_INPUT);
    expect(prompt).toContain("150 words");
  });
});

// ---------------------------------------------------------------------------
// 4. Prompt explicitly forbids new findings, severity changes, invented facts
// ---------------------------------------------------------------------------

describe("buildPrompt — explicit constraints present", () => {
  it("forbids introducing new findings beyond supplied evidence", () => {
    const prompt = buildPrompt(DEMO_INPUT);
    expect(prompt).toContain("Do not introduce any findings beyond the supplied evidence");
  });

  it("forbids changing severity or signal lists", () => {
    const prompt = buildPrompt(DEMO_INPUT);
    expect(prompt).toContain("Do not change the severity or signal lists");
  });

  it("forbids inventing repository facts", () => {
    const prompt = buildPrompt(DEMO_INPUT);
    expect(prompt).toContain("Do not invent repository facts");
  });
});

// ---------------------------------------------------------------------------
// 5. Model configuration comes from environment variable
// ---------------------------------------------------------------------------

describe("explainWithGranite — model configuration from env", () => {
  it("uses WATSONX_MODEL_ID from environment when set", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";
    process.env.WATSONX_MODEL_ID = "ibm/granite-3-2b-instruct";

    const mockFetch = makeMockFetch(200, makeWatsonxBody("explanation"));
    vi.stubGlobal("fetch", mockFetch);

    await explainWithGranite(DEMO_INPUT);

    const callBody = JSON.parse((mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(callBody.model_id).toBe("ibm/granite-3-2b-instruct");
  });

  it("uses default model id when WATSONX_MODEL_ID is not set", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";
    // WATSONX_MODEL_ID deliberately not set

    const mockFetch = makeMockFetch(200, makeWatsonxBody("explanation"));
    vi.stubGlobal("fetch", mockFetch);

    await explainWithGranite(DEMO_INPUT);

    const callBody = JSON.parse((mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    // Default should be a non-empty string model ID
    expect(typeof callBody.model_id).toBe("string");
    expect(callBody.model_id.length).toBeGreaterThan(0);
  });

  it("uses WATSONX_REGION from environment when set", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";
    process.env.WATSONX_REGION = "eu-de";

    const mockFetch = makeMockFetch(200, makeWatsonxBody("explanation"));
    vi.stubGlobal("fetch", mockFetch);

    await explainWithGranite(DEMO_INPUT);

    const callUrl = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(callUrl).toContain("eu-de");
  });

  it("passes project_id from WATSONX_PROJECT_ID env var in request body", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";
    process.env.WATSONX_PROJECT_ID = "my-project-42";

    const mockFetch = makeMockFetch(200, makeWatsonxBody("explanation"));
    vi.stubGlobal("fetch", mockFetch);

    await explainWithGranite(DEMO_INPUT);

    const callBody = JSON.parse((mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(callBody.project_id).toBe("my-project-42");
  });
});

// ---------------------------------------------------------------------------
// 6. API failure (non-2xx) → graceful undefined
// ---------------------------------------------------------------------------

describe("explainWithGranite — API failure", () => {
  it("returns undefined on 401 Unauthorized", async () => {
    process.env.WATSONX_API_KEY = "bad-key";

    vi.stubGlobal("fetch", makeMockFetch(401, { error: "Unauthorized" }));

    const result = await explainWithGranite(DEMO_INPUT);
    expect(result).toBeUndefined();
  });

  it("returns undefined on 500 Internal Server Error", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";

    vi.stubGlobal("fetch", makeMockFetch(500, { error: "Internal error" }));

    const result = await explainWithGranite(DEMO_INPUT);
    expect(result).toBeUndefined();
  });

  it("returns undefined on 429 Rate Limit", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";

    vi.stubGlobal("fetch", makeMockFetch(429, { error: "Too many requests" }));

    const result = await explainWithGranite(DEMO_INPUT);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Network error (fetch throws) → graceful undefined
// ---------------------------------------------------------------------------

describe("explainWithGranite — network error", () => {
  it("returns undefined when fetch throws", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error"))
    );

    const result = await explainWithGranite(DEMO_INPUT);
    expect(result).toBeUndefined();
  });

  it("does not throw when fetch rejects", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );

    await expect(explainWithGranite(DEMO_INPUT)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Granite output never affects deterministic fields
// ---------------------------------------------------------------------------

describe("explainWithGranite — deterministic boundary", () => {
  it("returned string is plain text only — it cannot contain severity changes", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";

    const explanation = "This is a plain explanation narrating the regression.";
    vi.stubGlobal("fetch", makeMockFetch(200, makeWatsonxBody(explanation)));

    const result = await explainWithGranite(DEMO_INPUT);

    // The function returns only a string — it has no mechanism to alter
    // severity, lostSignals, preservedSignals, repair, or verification.
    expect(typeof result).toBe("string");
    expect(result).toBe(explanation);
    // Input remains unchanged by the call.
    expect(DEMO_INPUT.severity).toBe("high");
    expect(DEMO_INPUT.lostSignalNames).toHaveLength(5);
    expect(DEMO_INPUT.preservedSignalNames).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 9. Empty Granite response → returns undefined
// ---------------------------------------------------------------------------

describe("explainWithGranite — empty response", () => {
  it("returns undefined when generated_text is an empty string", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";

    vi.stubGlobal("fetch", makeMockFetch(200, makeWatsonxBody("")));

    const result = await explainWithGranite(DEMO_INPUT);
    expect(result).toBeUndefined();
  });

  it("returns undefined when results array is empty", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";

    vi.stubGlobal("fetch", makeMockFetch(200, { results: [] }));

    const result = await explainWithGranite(DEMO_INPUT);
    expect(result).toBeUndefined();
  });

  it("returns undefined when results property is missing", async () => {
    process.env.WATSONX_API_KEY = "test-api-key";

    vi.stubGlobal("fetch", makeMockFetch(200, {}));

    const result = await explainWithGranite(DEMO_INPUT);
    expect(result).toBeUndefined();
  });
});
