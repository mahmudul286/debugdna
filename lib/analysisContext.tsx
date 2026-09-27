"use client";

/**
 * DebugDNA — shared analysis state via React context.
 *
 * Holds the current pipeline state so both the analysis page and report page
 * can access the same result without re-running the pipeline.
 *
 * State is kept in memory only — no localStorage required for the MVP flow.
 * On refresh the user is shown a recovery state.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { DiagnosticReport } from "@/analyzer/types";
import { PIPELINE_STAGES, runAnalysis, DEMO_SCENARIO } from "@/lib/api";

// ---------------------------------------------------------------------------
// Stage state
// ---------------------------------------------------------------------------

export type StageStatus = "pending" | "running" | "complete" | "error";

export interface StageState {
  id: string;
  label: string;
  status: StageStatus;
  message: string;
}

// ---------------------------------------------------------------------------
// Analysis state machine
// ---------------------------------------------------------------------------

export type AnalysisPhase =
  | "idle"
  | "loading"
  | "streaming"
  | "completed"
  | "error";

export interface AnalysisState {
  phase: AnalysisPhase;
  stages: StageState[];
  report: DiagnosticReport | null;
  error: string | null;
  liveMessage: string | null;
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface AnalysisContextValue extends AnalysisState {
  startAnalysis: () => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

function buildInitialStages(): StageState[] {
  return PIPELINE_STAGES.map((s) => ({
    id: s.id,
    label: s.label,
    status: "pending" as StageStatus,
    message: "",
  }));
}

const INITIAL_STATE: AnalysisState = {
  phase: "idle",
  stages: buildInitialStages(),
  report: null,
  error: null,
  liveMessage: null,
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  // Guard against setting state after unmount
  const isMounted = useRef(true);
  React.useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    setState({
      ...INITIAL_STATE,
      stages: buildInitialStages(),
    });
  }, []);

  const startAnalysis = useCallback(() => {
    // Reset stages, move to loading
    setState({
      phase: "loading",
      stages: buildInitialStages(),
      report: null,
      error: null,
      liveMessage: "Connecting to analysis pipeline…",
    });

    (async () => {
      try {
        // Mark first stage as running immediately
        if (isMounted.current) {
          setState((prev) => ({
            ...prev,
            phase: "streaming",
            liveMessage: "Running baseline failure…",
            stages: prev.stages.map((s, i) =>
              i === 0 ? { ...s, status: "running" } : s
            ),
          }));
        }

        for await (const event of runAnalysis(DEMO_SCENARIO)) {
          if (!isMounted.current) break;

          if (event.type === "stage") {
            const stageIdx = PIPELINE_STAGES.findIndex(
              (ps) => ps.id === event.stage
            );
            const nextStageIdx = stageIdx + 1;

            setState((prev) => ({
              ...prev,
              phase: "streaming",
              liveMessage: event.message,
              stages: prev.stages.map((s, i) => {
                if (i === stageIdx)
                  return { ...s, status: "complete", message: event.message };
                if (i === nextStageIdx && s.status === "pending")
                  return { ...s, status: "running" };
                return s;
              }),
            }));
          } else if (event.type === "report") {
            setState((prev) => ({
              ...prev,
              phase: "completed",
              report: event.report,
              liveMessage: "Analysis complete.",
              stages: prev.stages.map((s) =>
                s.status !== "complete"
                  ? { ...s, status: "complete" }
                  : s
              ),
            }));
          } else if (event.type === "error") {
            setState((prev) => ({
              ...prev,
              phase: "error",
              error: event.message,
              liveMessage: null,
            }));
          }
        }
      } catch (err: unknown) {
        if (!isMounted.current) return;
        const msg =
          err instanceof Error ? err.message : "Unexpected error occurred.";
        setState((prev) => ({
          ...prev,
          phase: "error",
          error: msg,
          liveMessage: null,
        }));
      }
    })();
  }, []);

  return (
    <AnalysisContext.Provider value={{ ...state, startAnalysis, reset }}>
      {children}
    </AnalysisContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAnalysis(): AnalysisContextValue {
  const ctx = useContext(AnalysisContext);
  if (!ctx) {
    throw new Error("useAnalysis must be used within AnalysisProvider");
  }
  return ctx;
}
