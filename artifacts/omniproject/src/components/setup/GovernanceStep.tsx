import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { getJson } from "../../lib/api";
import { Dot, Step } from "./shared";

/**
 * Step 8 — AI governance walkthrough. A guided, read-only pass over the AI "leash" so an
 * admin sees and tunes it during setup instead of discovering it later: the enforced
 * containment level, the approved-action allowlist (and how much of it is scoped), the
 * active autonomous write-grants, and the break-glass kill switch. Admin-only; the editors
 * themselves live in Settings → AI governance (linked from here).
 */
interface AutonomousPosture {
  level: string;
  source: string;
  grants: unknown[];
  aiKill: boolean;
}
interface ActionCatalogue {
  actions: { approved: boolean; write: boolean; scope?: { surfaces?: string[]; minRole?: string; backends?: string[] } }[];
}

const isScoped = (s: ActionCatalogue["actions"][number]["scope"]): boolean =>
  !!s && (!!s.surfaces?.length || !!s.minRole || !!s.backends?.length);

export function GovernanceStep({ isAdmin }: { isAdmin: boolean }) {
  // Admin-only data; skip the fetch entirely for non-admins (the step renders nothing).
  const { data: posture } = useQuery<AutonomousPosture>({
    queryKey: ["governance", "autonomous"],
    queryFn: () => getJson("/api/governance/autonomous"),
    enabled: isAdmin,
    staleTime: 15_000,
  });
  const { data: catalogue } = useQuery<ActionCatalogue>({
    queryKey: ["action-catalogue"],
    queryFn: () => getJson("/api/governance/actions"),
    enabled: isAdmin,
    staleTime: 15_000,
  });

  if (!isAdmin) return null;

  const approved = catalogue?.actions.filter((a) => a.approved) ?? [];
  const approvedWrites = approved.filter((a) => a.write).length;
  const scoped = approved.filter((a) => isScoped(a.scope)).length;
  const grants = posture?.grants.length ?? 0;

  return (
    <Step n={8} title="AI governance">
      <p className="text-sm text-muted-foreground">
        OmniProject ships with AI on a tight leash: it’s <strong>off by default on every surface</strong>,
        only read actions are approved, and autonomous writes need an explicit grant. Review the leash here
        before turning AI on anywhere.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="border border-border p-3" data-testid="gov-containment">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Containment</div>
          <div className="font-bold text-sm uppercase">{posture?.level ?? "—"}</div>
          <div className="text-xs text-muted-foreground">enforced floor · source: {posture?.source ?? "—"}</div>
        </div>

        <div className="border border-border p-3" data-testid="gov-kill">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Break-glass kill switch</div>
          <div className="flex items-center gap-2 font-bold text-sm">
            <Dot on={!posture?.aiKill} />
            {posture?.aiKill ? "ENGAGED — all AI stopped" : "Released (AI permitted)"}
          </div>
        </div>

        <div className="border border-border p-3" data-testid="gov-approved">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Approved actions</div>
          <div className="font-bold text-sm">{approved.length} approved</div>
          <div className="text-xs text-muted-foreground">{approvedWrites} write · {scoped} scoped (per surface/role/backend)</div>
        </div>

        <div className="border border-border p-3" data-testid="gov-grants">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Autonomous write-grants</div>
          <div className="flex items-center gap-2 font-bold text-sm">
            <Dot on={grants === 0} />
            {grants === 0 ? "None (no autonomous writes)" : `${grants} active`}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Tune any of these in{" "}
        <Link href="/settings" className="font-medium underline" data-testid="gov-settings-link">Settings → AI governance</Link>:
        per-surface enablement, the approved-action catalogue (with per-surface/role/backend scope),
        autonomous write-grants, and the kill switch. Changes are admin-gated and audited.
      </p>
    </Step>
  );
}
