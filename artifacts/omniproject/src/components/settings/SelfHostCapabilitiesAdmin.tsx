import { useMemo, useState } from "react";
import { useListProjects, useListProgrammes } from "@workspace/api-client-react";
import { useAuth, isPmoOrAdmin } from "../../lib/auth";
import { useSetProgrammeFeatures, useSetProjectFeatures, type GateLevel } from "../../lib/features";
import { useSelfHost, useSaveSelfHost, type SelfHostDomainRow } from "../../lib/selfhost";

/**
 * Self-host DB capabilities admin — governs WHICH domains OmniProject's own database holds, across
 * the org → programme → project hierarchy. Reuses the same gating model as feature governance:
 *   - **Org (admin)** opts a gated domain INTO the self-host DB (adoption).
 *   - **Programme/Project (PMO/admin)** narrows an org-adopted domain OFF for a scope.
 * The *mode* (off / augmenting / system-of-record) and the data-responsibility acknowledgement are
 * set in the setup wizard's self-host step; this screen tunes domain coverage within that mode.
 * Client-gated to PMO/admin — mirrors the server's `requireAnyRole("admin","pmo")` on the route.
 */
const REASON_LABEL: Record<string, string> = { cost: "cost", safety: "safety", storage: "storage" };

export function SelfHostCapabilitiesAdmin() {
  const { data: auth } = useAuth();
  const role = auth?.role;
  const canOrg = role === "admin";
  const canScope = role === "pmo" || role === "admin";

  const levels: GateLevel[] = [
    ...(canOrg ? (["org"] as const) : []),
    ...(canScope ? (["programme", "project"] as const) : []),
  ];
  const [level, setLevel] = useState<GateLevel>(levels[0] ?? "org");
  const [target, setTarget] = useState<string>("");

  const { data: programmesData } = useListProgrammes();
  const { data: projectsData } = useListProjects();
  const programmes = Array.isArray(programmesData) ? programmesData : [];
  const projects = Array.isArray(projectsData) ? projectsData : [];
  const project = projects.find((p) => p.id === target);
  const programmeId = level === "programme" ? (target || null) : level === "project" ? (project?.programmeId ?? null) : null;
  const projectId = level === "project" ? (target || null) : null;

  const scopeReady = level === "org" || !!target;
  const { data: state } = useSelfHost({ programmeId, projectId }, isPmoOrAdmin(role) && scopeReady);

  const save = useSaveSelfHost();
  const setProg = useSetProgrammeFeatures();
  const setProj = useSetProjectFeatures();
  const [msg, setMsg] = useState<string | null>(null);

  // The gated (opt-in) domains — core (issues) is always held and isn't a toggle.
  const gated = useMemo(() => (state?.domains ?? []).filter((d) => !d.core), [state]);
  const core = useMemo(() => (state?.domains ?? []).filter((d) => d.core), [state]);

  if (!isPmoOrAdmin(role)) {
    return <p className="text-sm text-muted-foreground" data-testid="selfhost-admin-readonly">You don't have a role that can manage self-host capabilities.</p>;
  }

  const saving = save.isPending || setProg.isPending || setProj.isPending;
  const options = level === "programme" ? programmes.map((p) => ({ id: p.id, name: p.name }))
    : level === "project" ? projects.map((p) => ({ id: p.id, name: p.name })) : [];

  async function toggleOrg(d: SelfHostDomainRow) {
    if (!state) return;
    setMsg(null);
    const adopted = new Set(state.config.adopted);
    if (adopted.has(d.id)) adopted.delete(d.id);
    else adopted.add(d.id);
    try {
      await save.mutateAsync({ ...state.config, adopted: [...adopted] });
      setMsg("Saved.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    }
  }

  async function toggleScope(d: SelfHostDomainRow) {
    if (!state || !target) return;
    setMsg(null);
    // Read the scope's current selfhost disable set off the resolved rows, then flip this domain.
    const disabledNow = new Set(
      (state.domains ?? []).filter((x) => !x.enabled && x.blockedAt === level).map((x) => `selfhost:${x.id}`),
    );
    const id = `selfhost:${d.id}`;
    if (disabledNow.has(id)) disabledNow.delete(id);
    else disabledNow.add(id);
    const config = { disabled: [...disabledNow], required: [], forbidden: [] };
    try {
      if (level === "programme") await setProg.mutateAsync({ programmeId: target, config });
      else await setProj.mutateAsync({ projectId: target, programmeId, config });
      setMsg("Saved.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    }
  }

  return (
    <section className="space-y-4" data-testid="selfhost-capabilities">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Self-host DB capabilities</h2>
        <p className="text-xs text-muted-foreground">
          Choose which domains OmniProject's own database holds. Mode:{" "}
          <strong data-testid="selfhost-mode">{state?.config?.mode ?? "off"}</strong>
          {state?.holdsOnlyCopy && (
            <span className="ml-1 text-amber-600">— your database holds the only copy of this data (your responsibility).</span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1" role="tablist" aria-label="Capability scope">
          {levels.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={level === l}
              onClick={() => { setLevel(l); setTarget(""); }}
              className={`px-3 py-1.5 text-xs font-black uppercase tracking-widest border ${level === l ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
              {l}
            </button>
          ))}
        </div>
        {level !== "org" && (
          <select aria-label={`${level} to govern`} value={target} onChange={(e) => setTarget(e.target.value)}
            className="h-8 rounded-none border border-border bg-background px-2 text-sm" data-testid="selfhost-target">
            <option value="">Select a {level}…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>

      {scopeReady && state?.config && (
        <>
          <ul className="divide-y divide-border border-2 border-foreground" data-testid="selfhost-domain-list">
            {core.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-4 p-3 bg-muted/30">
                <div>
                  <p className="font-bold">{d.label} <span className="text-[10px] uppercase tracking-widest text-muted-foreground">core</span></p>
                  <p className="text-xs text-muted-foreground">{d.unlocks}</p>
                </div>
                <span className="text-xs font-bold text-green-600 shrink-0">Always held</span>
              </li>
            ))}
            {gated.map((d) => {
              const lockedAbove = d.locked && d.lockedBy !== level;
              return (
                <li key={d.id} className="flex items-start justify-between gap-4 p-3" data-testid={`selfhost-row-${d.id}`}>
                  <div>
                    <p className="font-bold">{d.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.unlocks}{d.gate ? ` · gated (${REASON_LABEL[d.gate] ?? d.gate})` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{d.fieldCount} fields · {d.enabled ? "held" : `not held${d.blockedAt ? ` (off at ${d.blockedAt})` : ""}`}</p>
                  </div>
                  {lockedAbove ? (
                    <span className="text-xs italic text-muted-foreground shrink-0">
                      {d.policy === "require" ? "Required" : "Forbidden"} at {d.lockedBy} (locked)
                    </span>
                  ) : (
                    <button type="button"
                      onClick={() => (level === "org" ? toggleOrg(d) : toggleScope(d))}
                      disabled={saving || (level !== "org" && !d.enabled && d.blockedAt === "org")}
                      aria-pressed={d.enabled}
                      className="shrink-0 rounded-none border-2 border-foreground px-3 py-1.5 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                      {level === "org" ? (state.config.adopted.includes(d.id) ? "Adopted" : "Adopt") : d.enabled ? "On" : "Off"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {msg && <p className="text-xs text-muted-foreground" data-testid="selfhost-msg">{msg}</p>}
        </>
      )}
    </section>
  );
}
