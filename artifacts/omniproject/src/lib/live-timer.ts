import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Live time-tracking client hooks over `/api/timer/*` (roadmap 3.3). One running timer per user (ephemeral,
 * server-held in the shared-state KV). Start it against a project/issue, watch it tick, and stop it to get a
 * day-grained timesheet entry. Behind the default-off `timeTracking` feature module.
 */

export interface RunningTimer { startedAt: string; projectId: string; issueId?: string; note?: string }
export interface TimerEntry { projectId: string; issueId?: string; date: string; hours: number; note?: string }
export interface TimerState { running: boolean; timer?: RunningTimer; elapsedHours?: number }
export interface TimerStartInput { projectId: string; issueId?: string; note?: string }

export const timerKey = ["timer"] as const;

/** The caller's running timer + live elapsed hours (or {running:false}). Polls while a timer runs.
 *  `enabled` gates the fetch on the `timeTracking` feature: the `/api/timer` route is only mounted when
 *  that (default-off) module is on, so fetching it unconditionally would 404-spam the console on every
 *  page (the widget sits in the app shell). Callers pass `featureEnabled(features, "timeTracking")`. */
export function useTimer(enabled = true) {
  return useQuery({
    queryKey: timerKey,
    queryFn: () => getJson<TimerState>("/api/timer"),
    enabled,
    // Re-fetch the server's authoritative elapsed once a minute; the widget also ticks locally between polls.
    refetchInterval: (q) => (q.state.data?.running ? 60_000 : false),
    staleTime: 5_000,
  });
}

/** Start the caller's timer (replaces any already running). */
export function useStartTimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TimerStartInput) => sendJson<TimerState>("/api/timer/start", input, "POST"),
    onSuccess: (s) => qc.setQueryData(timerKey, s),
  });
}

/** Stop the caller's timer; resolves to the timesheet entry it produced. */
export function useStopTimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson<{ running: false; entry: TimerEntry }>("/api/timer/stop", undefined, "POST"),
    onSuccess: () => qc.setQueryData(timerKey, { running: false } satisfies TimerState),
  });
}

/** Format elapsed hours as H:MM (e.g. 1.5 → "1:30"). Pure. */
export function formatElapsed(hours: number): string {
  const total = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}
