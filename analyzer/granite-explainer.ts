/**
 * DebugDNA — Granite Explainer (Optional Layer)
 *
 * Sends structured deterministic evidence to IBM watsonx.ai / Granite and
 * returns a plain-language narration of the diagnosability regression.
 *
 * CRITICAL BOUNDARY:
 * - Granite is NOT the source of truth.
 * - This module NEVER creates findings, changes severity, modifies signal
 *   lists, alters repair suggestions, or controls verification results.
 * - It only narrates evidence that was already determined by the
 *   deterministic pipeline.
 *
 * Environment variables required (all server-side only — never exposed to
 * the browser):
 *   WATSONX_API_KEY        IBM Cloud IAM API key
 *   WATSONX_PROJECT_ID     watsonx.ai project ID
 *   WATSONX_MODEL_ID       (optional) Granite model ID; defaults to
 *                          ibm/granite-3-8b-instruct
 *   WATSONX_REGION         (optional) Region slug; defaults to us-south
 */

import type { ComparisonResult, FailureScenario } from "./types";

// ---------------------------------------------------------------------------
// Public input type
// ---------------------------------------------------------------------------

/** Structured deterministic evidence passed to Granite for narration only. */
export interface GraniteExplainerInput {
  scenario: Pick<FailureScenario, "description">;
  severity: ComparisonResult["severity"];
  lostSignalNames: string[];
  preservedSignalNames: string[];
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_ID = "ibm/granite-3-8b-instruct";
const DEFAULT_REGION = "us-south";
const MAX_TOKENS = 200; // generous ceiling; prompt limits prose to 150 words

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ask Granite to narrate the diagnosability regression in plain language.
 *
 * Returns `undefined` (silently) when:
 * - WATSONX_API_KEY is not set
 * - The API call fails for any reason
 *
 * The returned string is purely additive — it must never alter any
 * deterministic DiagnosticReport field.
 */
export async function explainWithGranite(
  input: GraniteExplainerInput
): Promise<string | undefined> {
  const apiKey = process.env.WATSONX_API_KEY;
  if (!apiKey) {
    // No credentials — silently return undefined; do not log.
    return undefined;
  }

  const projectId = process.env.WATSONX_PROJECT_ID;
  const modelId = process.env.WATSONX_MODEL_ID ?? DEFAULT_MODEL_ID;
  const region = process.env.WATSONX_REGION ?? DEFAULT_REGION;

  const endpoint = `https://${region}.ml.cloud.ibm.com/ml/v1/text/generation?version=2023-05-29`;

  const prompt = buildPrompt(input);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model_id: modelId,
        input: prompt,
        project_id: projectId,
        parameters: {
          decoding_method: "greedy",
          max_new_tokens: MAX_TOKENS,
          repetition_penalty: 1.05,
        },
      }),
    });

    if (!response.ok) {
      // API error — return undefined gracefully; do not throw.
      return undefined;
    }

    const json = (await response.json()) as WatsonxResponse;
    const text = json?.results?.[0]?.generated_text?.trim();
    return text || undefined;
  } catch {
    // Network failure or parse error — return undefined gracefully.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Prompt builder (exported for test inspection)
// ---------------------------------------------------------------------------

/**
 * Build the structured prompt from deterministic evidence only.
 * No raw repository content is included.
 */
export function buildPrompt(input: GraniteExplainerInput): string {
  const { scenario, severity, lostSignalNames, preservedSignalNames } = input;

  return [
    "You are a software diagnostics assistant. Explain the following diagnosability regression in 3–5 sentences.",
    "",
    `Scenario: ${scenario.description}`,
    `Severity: ${severity}`,
    `Lost diagnostic signals: ${lostSignalNames.join(", ")}`,
    `Preserved diagnostic signals: ${preservedSignalNames.join(", ")}`,
    "",
    "Explain: (1) what changed diagnostically, (2) why the lost signals make future failure diagnosis harder for an engineer, and (3) what the deterministic repair is intended to restore.",
    "",
    "IMPORTANT CONSTRAINTS:",
    "Do not introduce any findings beyond the supplied evidence.",
    "Do not change the severity or signal lists.",
    "Do not invent repository facts.",
    "",
    "Maximum output: 150 words.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Internal response type
// ---------------------------------------------------------------------------

interface WatsonxResponse {
  results?: Array<{ generated_text?: string }>;
}
