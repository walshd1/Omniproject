import { create } from "zustand";
import { useCallback, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { getJson } from "./api";
import { useFeatures, featureEnabled } from "./features";

/**
 * Read-ahead prefetch for the project read-model. Two clearly-separated tiers:
 *
 *  1. DETERMINISTIC prefetch-on-intent — ON FOR EVERYONE. When you hover (after a short dwell) or
 *     keyboard-focus a project, we warm exactly that project's issues into the React Query cache, so
 *     opening it feels instant. It's safe to default-on: it only fetches the ONE thing you're about
 *     to open anyway, the dwell delay means a quick mouse-sweep doesn't fire, and React Query's
 *     dedupe + `staleTime` stop redundant calls.
 *
 *  2. PREDICTIVE (speculative) loading — OPT-IN, off by default, behind a health warning AND the
 *     `predictivePrefetch` feature module. This warms data you HAVEN'T shown intent for (e.g. every
 *     project listed on the page), trading more speed for speculative load on the customer's backend
 *     that may never be used. Because the gateway is a stateless overlay, each prefetch is a real
 *     broker call, so this stays a deliberate, reversible choice.
 *
 * Both tiers only ever warm read-model GETs the user can already see — never AI, a mutation, or a
 * gated/step-up route — using the same query key the page reads, so it's a pure head-start.
 */

/** Dwell (ms) a pointer must rest on a project before the deterministic prefetch fires. */
const HOVER_DWELL_MS = 120;
const PREDICTIVE_KEY = "omni:predictive-prefetch";

function warmProjectIssues(qc: QueryClient, projectId: string): void {
  if (!projectId) return;
  void qc.prefetchQuery({
    queryKey: getGetProjectIssuesQueryKey(projectId),
    queryFn: () => getJson<Issue[]>(`/api/projects/${projectId}/issues`),
    staleTime: 30_000,
  });
}

// ── Predictive opt-in (per browser, off by default) ────────────────────────────────────────────
function loadPredictive(): boolean {
  try { return localStorage.getItem(PREDICTIVE_KEY) === "1"; } catch { return false; }
}

interface PredictiveSetting {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

export const usePredictivePrefetchSetting = create<PredictiveSetting>((set) => ({
  enabled: loadPredictive(),
  setEnabled: (v) => {
    try { localStorage.setItem(PREDICTIVE_KEY, v ? "1" : "0"); } catch { /* storage blocked — won't persist */ }
    set({ enabled: v });
  },
}));

export interface ProjectPrefetch {
  /** Deterministic hover-intent: start the dwell timer for a project (call from `onMouseEnter`). */
  onIntentEnter: (projectId: string) => void;
  /** Cancel a pending hover-intent (call from `onMouseLeave`). */
  onIntentLeave: () => void;
  /** Keyboard focus is explicit intent — warm immediately (call from `onFocus`). */
  onIntentFocus: (projectId: string) => void;
  /** True only when the predictive module is enabled AND the user opted in. */
  predictiveActive: boolean;
  /** Speculatively warm a set of projects (no-op unless `predictiveActive`). */
  runPredictive: (projectIds: string[]) => void;
}

/** Prefetch handlers for project surfaces. Deterministic tier is always live; predictive is gated. */
export function useProjectPrefetch(): ProjectPrefetch {
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onIntentEnter = useCallback((projectId: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => warmProjectIssues(qc, projectId), HOVER_DWELL_MS);
  }, [qc]);
  const onIntentLeave = useCallback(() => clearTimeout(timer.current), []);
  const onIntentFocus = useCallback((projectId: string) => warmProjectIssues(qc, projectId), [qc]);

  const { data: features } = useFeatures();
  const moduleOn = featureEnabled(features, "predictivePrefetch");
  const userOn = usePredictivePrefetchSetting((s) => s.enabled);
  const predictiveActive = moduleOn && userOn;

  const runPredictive = useCallback((projectIds: string[]) => {
    if (!predictiveActive) return;
    for (const id of projectIds) warmProjectIssues(qc, id);
  }, [predictiveActive, qc]);

  return { onIntentEnter, onIntentLeave, onIntentFocus, predictiveActive, runPredictive };
}
