import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type KeyResultKind } from "@workspace/backend-catalogue";
import { getJson, sendJson } from "./api";

export { KEY_RESULT_KINDS, formatKeyResultValue, type KeyResultKind } from "@workspace/backend-catalogue";

/**
 * Goals / OKRs client hooks over `/api/goals/*` (roadmap 3.2). A goal is a first-class OBJECTIVE with
 * measurable KEY RESULTS; its progress is derived server-side from key-result attainment. Saved to a STORAGE
 * TARGET the author picks — their private / a project's / the org-wide encrypted-JSON area — with a
 * self-describing id so a read routes to the right store. Behind the default-off `goals` feature module.
 */

export type GoalStorage = "user" | "project" | "org";
export type GoalStatus = "draft" | "on_track" | "at_risk" | "off_track" | "achieved";

export interface KeyResult { id: string; label: string; kind: KeyResultKind; startValue: number; target: number; current: number; unit?: string }
export interface GoalCheckIn { id: string; at: string; by: string | null; note: string | null; status: GoalStatus; progressPct: number; krValues: Record<string, number> }
export interface GoalLink { key: string; system: string; projectRef: string; itemRef: string; label?: string; linkedAt: string }

export interface GoalMeta {
  id: string; title: string; status: GoalStatus; progressPct: number;
  keyResultCount: number; checkInCount: number; lastCheckInAt: string | null; linkCount: number;
  cadence?: string | null; nextCheckInAt?: string | null;
  projectId?: string | null; ownerSub?: string | null; storage?: GoalStorage; updatedAt: string;
}
export interface Goal extends GoalMeta {
  description: string | null;
  keyResults: KeyResult[];
  checkins: GoalCheckIn[];
  links: GoalLink[];
  version: number;
  createdAt: string;
  updatedBy: string | null;
}

export interface GoalInput {
  title: string; description?: string; status?: GoalStatus;
  keyResults: Array<Pick<KeyResult, "label" | "target" | "current"> & Partial<KeyResult>>;
  cadence?: string | null; storage?: GoalStorage; projectId?: string | null;
}
export interface CheckInInput { note?: string; status?: GoalStatus; krValues?: Record<string, number> }
export interface LinkInput { system: string; projectRef: string; itemRef: string; label?: string }

export const goalsKey = (projectId?: string) => ["goals", projectId ?? "all"] as const;
export const goalKey = (id: string) => ["goal", id] as const;

/** The goals (key results omitted — a listing), optionally scoped to a project. */
export function useGoals(projectId?: string) {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return useQuery({ queryKey: goalsKey(projectId), queryFn: () => getJson<GoalMeta[]>(`/api/goals${qs}`), staleTime: 15_000 });
}

/** One goal with its key results, check-ins and links. */
export function useGoal(id: string | undefined) {
  return useQuery({
    queryKey: goalKey(id ?? ""),
    queryFn: () => getJson<Goal>(`/api/goals/${encodeURIComponent(id!)}`),
    enabled: !!id,
    staleTime: 10_000,
  });
}

function useGoalInvalidation() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ["goals"] });
    if (id) void qc.invalidateQueries({ queryKey: goalKey(id) });
  };
}

/** Create a goal (contributor+ server-side). */
export function useCreateGoal() {
  const invalidate = useGoalInvalidation();
  return useMutation({
    mutationFn: (input: GoalInput) => sendJson<Goal>("/api/goals", input, "POST"),
    onSuccess: (g) => invalidate(g.id),
  });
}

/** Update a goal in place. */
export function useUpdateGoal() {
  const invalidate = useGoalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: GoalInput }) => sendJson<Goal>(`/api/goals/${encodeURIComponent(id)}`, input, "PUT"),
    onSuccess: (g) => invalidate(g.id),
  });
}

/** Record a progress check-in. */
export function useCheckInGoal() {
  const invalidate = useGoalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CheckInInput }) => sendJson<Goal>(`/api/goals/${encodeURIComponent(id)}/checkin`, input, "POST"),
    onSuccess: (g) => invalidate(g.id),
  });
}

/** Link a work item to a goal. */
export function useLinkGoal() {
  const invalidate = useGoalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LinkInput }) => sendJson<Goal>(`/api/goals/${encodeURIComponent(id)}/links`, input, "POST"),
    onSuccess: (g) => invalidate(g.id),
  });
}

/** Unlink a work item by its link key. */
export function useUnlinkGoal() {
  const invalidate = useGoalInvalidation();
  return useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) => sendJson<Goal>(`/api/goals/${encodeURIComponent(id)}/links/${encodeURIComponent(key)}`, undefined, "DELETE"),
    onSuccess: (g) => invalidate(g?.id),
  });
}

/** Delete a goal. */
export function useDeleteGoal() {
  const invalidate = useGoalInvalidation();
  return useMutation({
    mutationFn: (id: string) => sendJson<void>(`/api/goals/${encodeURIComponent(id)}`, undefined, "DELETE"),
    onSuccess: () => invalidate(),
  });
}

/** The tint for a status badge. */
export function goalStatusTone(status: GoalStatus): string {
  switch (status) {
    case "achieved": return "text-green-600 border-green-500/40 bg-green-500/10";
    case "on_track": return "text-blue-600 border-blue-500/40 bg-blue-500/10";
    case "at_risk": return "text-amber-600 border-amber-500/40 bg-amber-500/10";
    case "off_track": return "text-red-600 border-red-500/40 bg-red-500/10";
    default: return "text-muted-foreground border-border";
  }
}

export const GOAL_STATUSES: GoalStatus[] = ["draft", "on_track", "at_risk", "off_track", "achieved"];
