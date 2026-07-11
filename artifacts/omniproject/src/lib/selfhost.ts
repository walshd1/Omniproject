import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Self-host DB adoption client. Mirrors the gateway's selfhost model (selfhost/*): a mode
 * (off | augmenting | system-of-record) plus the org-adopted domain set, resolved into per-domain
 * gating rows. Adoption is admin-gated and — the "disclose, don't insure" posture — gated behind an
 * explicit data-responsibility acknowledgement. This drives the setup wizard step + the admin screen.
 */
export type SelfHostMode = "off" | "augmenting" | "system-of-record";

/** A resolved domain row from the gateway (mirrors selfhost/capability-gating `DomainRow`). */
export interface SelfHostDomainRow {
  id: string;
  label: string;
  core: boolean;
  gate: "safety" | "cost" | "storage" | null;
  unlocks: string;
  fieldCount: number;
  enabled: boolean;
  locked: boolean;
  lockedBy?: "org" | "programme" | "project";
  policy?: "require" | "forbid";
  blockedAt?: "org" | "programme" | "project";
}

/** The persisted adoption config (mirrors settings `SelfHostConfig`). */
export interface SelfHostConfig {
  mode: SelfHostMode;
  adopted: string[];
  acknowledgedDataResponsibility: boolean;
}

export interface SelfHostState {
  config: SelfHostConfig;
  domains: SelfHostDomainRow[];
  enabledDomains: string[];
  holdsOnlyCopy: boolean;
}

/** A resolution scope: a project and/or its programme. Omit both for org-level. */
export interface SelfHostScope {
  programmeId?: string | null;
  projectId?: string | null;
}

export const selfHostQueryKey = (scope: SelfHostScope = {}) =>
  ["self-host", scope.programmeId ?? null, scope.projectId ?? null] as const;

function scopeQuery(scope: SelfHostScope): string {
  const p = new URLSearchParams();
  if (scope.programmeId) p.set("programmeId", scope.programmeId);
  if (scope.projectId) p.set("projectId", scope.projectId);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Read the current adoption + resolved domain gating for a scope (admin/PMO). */
export function useSelfHost(scope: SelfHostScope = {}, enabled = true) {
  return useQuery({
    queryKey: selfHostQueryKey(scope),
    queryFn: () => getJson<SelfHostState>(`/api/setup/self-host${scopeQuery(scope)}`),
    enabled,
    staleTime: 30_000,
  });
}

/** Persist an adoption config (admin). The gateway rejects a non-off mode without the ack (400). */
export function useSaveSelfHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: SelfHostConfig) => sendJson<SelfHostState>("/api/setup/self-host", config, "POST"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["self-host"] });
      qc.invalidateQueries({ queryKey: ["features"] });
    },
  });
}

/** Does the self-host DB hold the ONLY copy of some data? True for any non-off adoption. */
export function holdsOnlyCopy(mode: SelfHostMode): boolean {
  return mode !== "off";
}

/** A guardrail verdict (mirrors selfhost/setup-wizard `Guardrail`). `block` stops completion. */
export interface Guardrail {
  id: "data-responsibility" | "prefer-existing-tool" | "augmenting-fills-gaps-only" | "system-of-record-authority";
  level: "block" | "warn";
  active: boolean;
  message: string;
}

/** The four guardrails, evaluated client-side so the wizard can render them live (the gateway
 *  re-enforces the one BLOCK on save). Kept in lock-step with selfhost/setup-wizard.guardrails. */
export function guardrails(mode: SelfHostMode, acknowledged: boolean): Guardrail[] {
  const adopting = mode !== "off";
  return [
    {
      id: "data-responsibility",
      level: "block",
      active: adopting && !acknowledged,
      message:
        "Data held in your database is yours to own, secure and back up. OmniProject does not operate, " +
        "back up, or warrant it. You must acknowledge this before enabling self-host storage.",
    },
    {
      id: "prefer-existing-tool",
      level: "warn",
      active: adopting,
      message:
        "Self-hosting our database is the non-preferred deployment. OmniProject is a stateless overlay — " +
        "prefer connecting an existing tool so it stays your source of truth.",
    },
    {
      id: "augmenting-fills-gaps-only",
      level: "warn",
      active: mode === "augmenting",
      message:
        "In augmenting mode your database only owns fields no connected backend can hold. Fields a backend " +
        "already stores stay with that backend.",
    },
    {
      id: "system-of-record-authority",
      level: "warn",
      active: mode === "system-of-record",
      message:
        "In system-of-record mode your database becomes the authoritative source for the adopted domains, and " +
        "holds the only copy of that data. The OpenProject-compatible export view is your exit path.",
    },
  ];
}

/** True when the wizard step may finish: `off` always completes; any adoption needs the ack. */
export function canComplete(mode: SelfHostMode, acknowledged: boolean): boolean {
  return guardrails(mode, acknowledged).every((g) => !(g.active && g.level === "block"));
}
