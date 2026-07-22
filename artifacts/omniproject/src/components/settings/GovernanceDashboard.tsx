import { useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useVirtualRows } from "../../lib/use-virtual-rows";
import {
  useGovernance, useGovernanceLog, STATE_INFO, KIND_LABEL,
  type CapabilityKind, type DeploymentState, type CapabilityLogEntry,
} from "../../lib/tools";
import { useQueryClient } from "@tanstack/react-query";
import { useAutonomousGrants, relaxContainment, setAiKill, CONTAINMENT_INFO, SOURCE_LABEL, type AiContainment } from "../../lib/containment";
import { withStepUp } from "../../lib/step-up";
import { ConfirmButton } from "../ConfirmButton";

/**
 * Admin governance dashboard — visibility into what's turned on and the live activity
 * trail. Shows, per kind, how many capabilities are ON (state ≠ off) with their states,
 * and a feed of recent uses / blocks / config changes (capability, surface, who, when).
 * Admin-only. Read-only — the controls live in GovernanceAdmin.
 */
const KIND_ORDER: CapabilityKind[] = ["ai-tool", "mcp", "ai-provider", "broker", "vendor"];

const ACTION_STYLE: Record<CapabilityLogEntry["action"], { label: string; cls: string }> = {
  use: { label: "used", cls: "text-emerald-600" },
  blocked: { label: "blocked", cls: "text-red-600" },
  configured: { label: "configured", cls: "text-amber-600" },
};

export function GovernanceDashboard() {
  const { data: auth } = useAuth();
  const { data } = useGovernance();
  const { data: log } = useGovernanceLog();
  const { data: autonomous } = useAutonomousGrants();
  const qc = useQueryClient();

  // Both are step-up gated and kept quiet on failure (surfaced by the disabled/refetch state).
  const onRelax = (level: AiContainment): Promise<unknown> =>
    withStepUp(async () => { await relaxContainment(level); await qc.invalidateQueries({ queryKey: ["autonomous-grants"] }); });

  const onToggleKill = (engage: boolean): Promise<unknown> =>
    withStepUp(async () => { await setAiKill(engage); await qc.invalidateQueries({ queryKey: ["autonomous-grants"] }); });

  // Virtualize the activity trail so a long audit feed renders only the visible slice within its
  // fixed-height scroll box. The hook falls back to rendering every entry when unmeasured (tests) or
  // short — so behaviour is unchanged for small feeds. Declared before the early returns to keep the
  // hook order stable.
  const activityRef = useRef<HTMLUListElement | null>(null);
  const activity = useVirtualRows(activityRef, log?.entries?.length ?? 0, { estimate: 22, min: 60 });

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!data?.capabilities) return null;

  const caps = data.capabilities;
  const entries = log?.entries ?? [];
  const visibleEntries = entries.slice(activity.start, activity.end);

  return (
    <Card data-testid="governance-dashboard">
      <CardHeader>
        <CardTitle>Governance dashboard</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Autonomous AI posture: the containment "leash" + the active, scoped write grants. */}
        {autonomous && (
          <div className="rounded border border-border p-2" data-testid="autonomous-posture">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Autonomous AI</h3>
              {autonomous.aiKill
                ? <ConfirmButton
                    testId="ai-kill-toggle"
                    className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold text-white"
                    title="Release the AI kill switch?"
                    description="This re-arms every autonomous AI capability and scoped write grant that was suspended. Only do this once you've confirmed whatever triggered the kill is resolved."
                    confirmLabel="Release"
                    onConfirm={() => void onToggleKill(false)}
                  >
                    AI KILLED — release
                  </ConfirmButton>
                : <ConfirmButton
                    testId="ai-kill-toggle"
                    className="rounded border border-red-300 px-1.5 py-0.5 text-[11px] font-medium text-red-700"
                    triggerTitle="Break-glass: stop all AI + suspend autonomous writes"
                    title="Kill all AI capabilities?"
                    description="This is a break-glass switch: every AI tool, MCP surface, and autonomous write grant is suspended immediately across the deployment, for every user. Use this if something's misbehaving and you need it stopped NOW."
                    confirmLabel="Kill AI"
                    onConfirm={() => void onToggleKill(true)}
                  >
                    Kill AI
                  </ConfirmButton>}
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${CONTAINMENT_INFO[autonomous.level].cls}`} title={CONTAINMENT_INFO[autonomous.level].note}>
                {CONTAINMENT_INFO[autonomous.level].label}
              </span>
              <span className="text-[11px] text-muted-foreground">source: {SOURCE_LABEL[autonomous.source]}</span>
              <label className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                relax floor
                <select
                  value={autonomous.relax}
                  onChange={(e) => void onRelax(e.target.value as AiContainment)}
                  data-testid="relax-select"
                  className="h-6 rounded border border-border bg-transparent px-1 text-[11px]"
                >
                  <option value="public">full (default)</option>
                  <option value="remote">high</option>
                  <option value="local">standard</option>
                  <option value="off">minimal</option>
                </select>
              </label>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              {CONTAINMENT_INFO[autonomous.level].note} The AI source ({SOURCE_LABEL[autonomous.source]}) is a hard floor — relaxing can’t go below it.
            </p>
            {autonomous.grants.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="no-grants">No write grants — autonomous actors cannot write anything (default deny).</p>
            ) : (
              <ul className="space-y-1 text-xs" data-testid="grant-list">
                {autonomous.grants.map((g) => (
                  <li key={g.actorId} className="rounded bg-muted/50 p-1.5">
                    <span className="font-mono font-medium">{g.actorId}</span>
                    <span className="text-muted-foreground"> may {g.actions.join(", ") || "—"}</span>
                    {g.projects && <span> · projects: {g.projects.join(", ")}</span>}
                    {g.surfaces && <span> · surfaces: {g.surfaces.join(", ")}</span>}
                    {g.fields && <span> · fields: {g.fields.join(", ")}</span>}
                    {typeof g.maxWrites === "number" && <span> · ≤{g.maxWrites} writes</span>}
                    {typeof g.notAfter === "number" && <span> · until {new Date(g.notAfter).toLocaleDateString()}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* What's on, by kind. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {KIND_ORDER.map((kind) => {
            const inKind = caps.filter((c) => c.kind === kind);
            const on = inKind.filter((c) => c.state !== "off");
            return (
              <div key={kind} className="rounded border border-border p-2">
                <div className="text-xs text-muted-foreground">{KIND_LABEL[kind]}</div>
                <div className="text-sm font-semibold tabular-nums">{on.length}<span className="text-muted-foreground"> / {inKind.length} on</span></div>
              </div>
            );
          })}
        </div>

        {/* Everything currently enabled (state ≠ off). */}
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enabled now</h3>
          {caps.filter((c) => c.state !== "off").length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="nothing-enabled">Nothing is enabled — no AI, brokers or vendors are active.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {caps.filter((c) => c.state !== "off").map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{c.label}</span>
                  <StateTag state={c.state} {...(Object.keys(c.surfaces).length ? { extra: `+${Object.keys(c.surfaces).length} screen overrides` } : {})} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Live activity trail. */}
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent activity</h3>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul ref={activityRef} className="max-h-64 space-y-1 overflow-auto text-xs" data-testid="activity-log">
              {activity.padTop > 0 && <li aria-hidden="true" style={{ height: activity.padTop }} />}
              {visibleEntries.map((e, idx) => {
                const i = activity.start + idx;
                return (
                <li key={i} data-vrow className="flex items-center justify-between gap-2 border-b border-border/50 py-0.5">
                  <span className="truncate">
                    <span className={`font-semibold ${ACTION_STYLE[e.action].cls}`}>{ACTION_STYLE[e.action].label}</span>{" "}
                    <span className="font-mono">{e.capability}</span>
                    {e.surface && <span className="text-muted-foreground"> on {e.surface}</span>}
                    {e.actor && <span className="text-muted-foreground"> · {e.actor}</span>}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{STATE_INFO[e.state].label}</span>
                </li>
                );
              })}
              {activity.padBottom > 0 && <li aria-hidden="true" style={{ height: activity.padBottom }} />}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StateTag({ state, extra }: { state: DeploymentState; extra?: string }) {
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {STATE_INFO[state].label}{extra ? ` · ${extra}` : ""}
    </span>
  );
}
