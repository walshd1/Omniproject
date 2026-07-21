import { useMemo, useState } from "react";
import { useListProjects, useListProgrammes } from "@workspace/api-client-react";
import { useAuth } from "../../lib/auth";
import {
  useFeatures,
  useSetOrgGovernance,
  useSetProgrammeFeatures,
  useSetProjectFeatures,
  type FeatureStatus,
  type GateLevel,
  type GovernanceKind,
} from "../../lib/features";

/**
 * Feature gating + governance admin panel — the org → programme → project hierarchy.
 * Each level sees only what its parent allows; inherited hard mandates (require/forbid) show as
 * locked and can't be overridden here. Org (admin) sets the approved superset + must-use/must-not-use;
 * a PMO narrows/mandates per programme; a PM per project. Mirrors the server enforcement.
 */

type Choice = "default" | "on" | "off" | "require" | "forbid";

/** The current choice a feature is in at the editing level, from the saved config. */
function choiceFor(level: GateLevel, id: string, org: OrgConfig, scope: ScopeCfg): Choice {
  if (level === "org") {
    if (org.governance.required.includes(id)) return "require";
    if (org.governance.forbidden.includes(id)) return "forbid";
    if (org.disabled.includes(id)) return "off";
    if (org.enabled.includes(id)) return "on";
    return "default";
  }
  if (scope.required.includes(id)) return "require";
  if (scope.forbidden.includes(id)) return "forbid";
  if (scope.disabled.includes(id)) return "off";
  return "default";
}

interface OrgConfig { disabled: string[]; enabled: string[]; governance: { required: string[]; forbidden: string[] } }
interface ScopeCfg { disabled: string[]; required: string[]; forbidden: string[] }

const REASON_LABEL: Record<string, string> = { cost: "cost", safety: "safety", storage: "storage" };

/** Section headings for the catalogue planes, in display order. */
const KIND_GROUPS: { kind: GovernanceKind; label: string }[] = [
  { kind: "module", label: "Feature modules" },
  { kind: "report", label: "Reports" },
  { kind: "methodology", label: "Methodologies" },
];

export function FeatureGovernance() {
  const { data: auth } = useAuth();
  const role = auth?.role;
  const canOrg = role === "admin";
  const canProgramme = role === "pmo" || role === "admin";
  const canProject = role === "manager" || role === "pmo" || role === "admin";

  const levels: GateLevel[] = [
    ...(canOrg ? (["org"] as const) : []),
    ...(canProgramme ? (["programme"] as const) : []),
    ...(canProject ? (["project"] as const) : []),
  ];
  const [level, setLevel] = useState<GateLevel>(levels[0] ?? "project");
  const [target, setTarget] = useState<string>("");

  const { data: programmesData } = useListProgrammes();
  const { data: projectsData } = useListProjects();
  // A generated list hook can momentarily resolve to a non-array (loading/error/unexpected
  // payload); `?? []` only guards null/undefined, so narrow with Array.isArray.
  const programmes = Array.isArray(programmesData) ? programmesData : [];
  const projects = Array.isArray(projectsData) ? projectsData : [];
  const project = projects.find((p) => p.id === target);
  const programmeId = level === "programme" ? (target || null) : level === "project" ? (project?.programmeId ?? null) : null;
  const projectId = level === "project" ? (target || null) : null;

  // Resolve the effective state for the current scope (so locks/inherited mandates show).
  const { data: features } = useFeatures({ programmeId, projectId });

  // Local edit state seeded from the resolved features (segmented choice per id).
  const [edits, setEdits] = useState<Record<string, Choice>>({});
  const orgFromFeatures: OrgConfig = useMemo(() => seedOrg(features), [features]);
  const scopeFromFeatures: ScopeCfg = useMemo(() => seedScope(features, level), [features, level]);

  const choice = (f: FeatureStatus): Choice =>
    edits[f.id] ?? choiceFor(level, f.id, orgFromFeatures, scopeFromFeatures);

  const setOrg = useSetOrgGovernance();
  const setProg = useSetProgrammeFeatures();
  const setProj = useSetProjectFeatures();
  const [msg, setMsg] = useState<string | null>(null);

  const needsTarget = level !== "org";
  const options = level === "programme" ? programmes.map((p) => ({ id: p.id, name: p.name }))
    : level === "project" ? projects.map((p) => ({ id: p.id, name: p.name })) : [];

  async function save() {
    setMsg(null);
    try {
      const merged: Record<string, Choice> = {};
      for (const f of features ?? []) merged[f.id] = choice(f);
      if (level === "org") {
        await setOrg.mutateAsync(buildOrgPayload(merged));
      } else {
        const cfg = buildScopePayload(merged);
        if (level === "programme") await setProg.mutateAsync({ programmeId: target, config: cfg });
        else await setProj.mutateAsync({ projectId: target, programmeId, config: cfg });
      }
      setEdits({});
      setMsg("Saved.");
    } catch (e) {
      // Drop the optimistic edits so the table snaps back to the server's authoritative
      // resolution (the rejected choice never took effect); show why.
      setEdits({});
      setMsg(e instanceof Error ? e.message : "Save failed.");
    }
  }

  const saving = setOrg.isPending || setProg.isPending || setProj.isPending;

  if (levels.length === 0) {
    return <p className="text-sm text-muted-foreground">You don't have a role that can manage feature governance.</p>;
  }

  const choices: { value: Choice; label: string }[] = level === "org"
    ? [{ value: "default", label: "Default" }, { value: "on", label: "On" }, { value: "off", label: "Off" }, { value: "require", label: "Require" }, { value: "forbid", label: "Forbid" }]
    : [{ value: "default", label: "Inherit" }, { value: "off", label: "Disable" }, { value: "require", label: "Require" }, { value: "forbid", label: "Forbid" }];

  return (
    <section className="space-y-4" data-testid="feature-governance">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1" role="tablist" aria-label="Governance level">
          {levels.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={level === l}
              onClick={() => { setLevel(l); setTarget(""); setEdits({}); }}
              className={`px-3 py-1.5 text-xs font-black uppercase tracking-widest border ${level === l ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
              {l}
            </button>
          ))}
        </div>
        {needsTarget && (
          <select aria-label={`${level} to govern`} value={target} onChange={(e) => { setTarget(e.target.value); setEdits({}); }}
            className="h-8 rounded-none border border-border bg-background px-2 text-sm" data-testid="governance-target">
            <option value="">Select a {level}…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>

      {(level === "org" || target) && (
        <>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                <th className="py-1.5 pr-3 font-bold">Feature</th>
                <th className="py-1.5 px-2 font-bold">Policy</th>
                <th className="py-1.5 px-2 font-bold">State</th>
              </tr>
            </thead>
            {KIND_GROUPS.map(({ kind, label }) => {
              const rows = (features ?? []).filter((f) => f.kind === kind);
              if (rows.length === 0) return null;
              return (
                <tbody key={kind}>
                  <tr className="bg-muted/40">
                    <td colSpan={3} className="py-1 px-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</td>
                  </tr>
                  {rows.map((f) => {
                    // A hard mandate from a HIGHER level locks this row (can't edit below it).
                    const lockedAbove = !!f.locked && f.lockedBy !== level;
                    return (
                      <tr key={f.id} className="border-b border-border/50" data-testid={`gov-row-${f.id}`}>
                        <td className="py-1.5 pr-3">
                          <div className="font-bold">{f.label}</div>
                          <div className="text-muted-foreground">{f.description}{f.defaultOff && f.reason ? ` · default-off (${REASON_LABEL[f.reason]})` : ""}</div>
                        </td>
                        <td className="py-1.5 px-2">
                          {lockedAbove ? (
                            <span className="text-muted-foreground italic">
                              {f.policy === "require" ? "Required" : "Forbidden"} at {f.lockedBy} (locked)
                            </span>
                          ) : (
                            <div className="flex gap-1" role="radiogroup" aria-label={`${f.label} policy`}>
                              {choices.map((c) => (
                                <button key={c.value} type="button" role="radio" aria-checked={choice(f) === c.value}
                                  onClick={() => setEdits((e) => ({ ...e, [f.id]: c.value }))}
                                  className={`px-2 py-1 border text-[11px] font-bold ${choice(f) === c.value ? "border-primary bg-primary/10" : "border-border"}`}>
                                  {c.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 px-2">
                          <span className={f.enabled ? "text-green-600" : "text-muted-foreground"}>{f.enabled ? "On" : `Off${f.blockedAt ? ` (${f.blockedAt})` : ""}`}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
          <div className="flex items-center gap-3">
            <button type="button" onClick={save} data-testid="governance-save" disabled={saving}
              className="border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
              {saving ? "Saving…" : `Save ${level} policy`}
            </button>
            {msg && <span className="text-xs text-muted-foreground" data-testid="governance-msg">{msg}</span>}
          </div>
        </>
      )}
    </section>
  );
}

function buildOrgPayload(merged: Record<string, Choice>) {
  const enabled: string[] = [], disabled: string[] = [], required: string[] = [], forbidden: string[] = [];
  for (const [id, c] of Object.entries(merged)) {
    if (c === "require") required.push(id);
    else if (c === "forbid") forbidden.push(id);
    else if (c === "on") enabled.push(id);
    else if (c === "off") disabled.push(id);
  }
  return { enabledFeatures: enabled, disabledFeatures: disabled, featureGovernance: { required, forbidden } };
}

function buildScopePayload(merged: Record<string, Choice>): ScopeCfg {
  const cfg: ScopeCfg = { disabled: [], required: [], forbidden: [] };
  for (const [id, c] of Object.entries(merged)) {
    if (c === "require") cfg.required.push(id);
    else if (c === "forbid") cfg.forbidden.push(id);
    else if (c === "off") cfg.disabled.push(id);
  }
  return cfg;
}

function seedOrg(features: FeatureStatus[] | undefined): OrgConfig {
  const required: string[] = [], forbidden: string[] = [], disabled: string[] = [], enabled: string[] = [];
  for (const f of features ?? []) {
    if (f.lockedBy === "org" && f.policy === "require") required.push(f.id);
    else if (f.lockedBy === "org" && f.policy === "forbid") forbidden.push(f.id);
    else if (!f.enabled && f.blockedAt === "org") disabled.push(f.id);
    else if (f.enabled && f.defaultOff) enabled.push(f.id);
  }
  return { disabled, enabled, governance: { required, forbidden } };
}

function seedScope(features: FeatureStatus[] | undefined, level: GateLevel): ScopeCfg {
  const cfg: ScopeCfg = { disabled: [], required: [], forbidden: [] };
  for (const f of features ?? []) {
    if (f.lockedBy === level && f.policy === "require") cfg.required.push(f.id);
    else if (f.lockedBy === level && f.policy === "forbid") cfg.forbidden.push(f.id);
    else if (!f.enabled && f.blockedAt === level) cfg.disabled.push(f.id);
  }
  return cfg;
}
