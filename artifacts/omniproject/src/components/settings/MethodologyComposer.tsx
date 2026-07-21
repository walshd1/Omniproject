import { useEffect, useMemo, useState } from "react";
import { useAuth, isPmoOrAdmin } from "../../lib/auth";
import { useMethodologyComposition, useSaveMethodologyComposition } from "../../lib/methodology-composition-api";
import { buildCompositionItems, methodologyLabel } from "../../lib/methodology-composition-catalogue";
import { applyPreset, toggleItem, isEnabled, derivePresets, type Composition, type CompositionKind } from "../../lib/methodology-composition";
import { MethodologyDeploy } from "./MethodologyDeploy";
import { DelegationPolicyAdmin } from "./DelegationPolicyAdmin";
import { ScopeOverrideAdmin } from "./ScopeOverrideAdmin";

/**
 * Methodology composer (PMO/admin) — pick which artifacts, outputs and rulesets are visible. A preset is
 * a one-click starting point (all of Scrum, all of PRINCE2, …); from there you tick individual items, so
 * a house style that is "some Scrum + some PRINCE2" is just a curated set. "Show everything" clears the
 * curation (the default). Only the org's selection is saved; the catalogues stay in code.
 */
const KIND_LABEL: Record<CompositionKind, string> = {
  report: "Reports", view: "Views", screen: "Screens", output: "Outputs", ruleset: "Rulesets", form: "Forms",
};
const KIND_ORDER: CompositionKind[] = ["report", "view", "screen", "output", "ruleset"];

const sameComposition = (a: Composition, b: Composition): boolean => JSON.stringify(a) === JSON.stringify(b);

export function MethodologyComposer() {
  const { data: auth } = useAuth();
  const { data: saved } = useMethodologyComposition();
  const save = useSaveMethodologyComposition();
  const items = useMemo(buildCompositionItems, []);
  const presets = useMemo(() => derivePresets(items, methodologyLabel), [items]);

  // Draft mirrors the saved composition until edited; undefined only while loading.
  const [draft, setDraft] = useState<Composition | undefined>(undefined);
  useEffect(() => { setDraft((d) => (d === undefined && saved !== undefined ? (saved ?? null) : d)); }, [saved]);
  const composition: Composition = draft === undefined ? null : draft;

  if (!isPmoOrAdmin(auth?.role)) return null;

  const curated = composition !== null;
  const changed = draft !== undefined && !sameComposition(composition, saved ?? null);
  const enabledCount = items.filter((i) => isEnabled(composition, i.id)).length;

  return (
    <div className="space-y-4" data-testid="methodology-composer">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Methodology composer</h2>
        <p className="text-xs text-muted-foreground">
          Choose what's visible. Start from a methodology preset, then tick individual items to mix — e.g. some
          Scrum and some PRINCE2. “Show everything” turns curation off.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <button key={p.methodology} type="button" data-testid={`preset-${p.methodology}`}
            className="px-2 py-1 text-xs font-black uppercase tracking-wide rounded-none border-2 border-foreground hover:bg-muted"
            onClick={() => setDraft(applyPreset(composition, p))}>
            {p.label}
          </button>
        ))}
        <button type="button" data-testid="composition-show-all"
          className="px-2 py-1 text-xs font-bold uppercase tracking-wide rounded-none border border-border text-muted-foreground hover:bg-muted"
          onClick={() => setDraft(null)}>
          Show everything
        </button>
        <span className="text-[10px] text-muted-foreground" data-testid="composition-summary">
          {curated ? `${enabledCount} of ${items.length} shown` : "All shown (uncurated)"}
        </span>
      </div>

      {KIND_ORDER.map((kind) => {
        const group = items.filter((i) => i.kind === kind);
        if (group.length === 0) return null;
        return (
          <section key={kind} data-testid={`composition-group-${kind}`}>
            <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{KIND_LABEL[kind]}</h3>
            <div className="grid gap-1 sm:grid-cols-2">
              {group.map((it) => (
                <label key={it.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={isEnabled(composition, it.id)} data-testid={`composition-item-${it.id}`}
                    onChange={() => setDraft(toggleItem(composition, items, it.id))} />
                  <span className="truncate">{it.label}</span>
                </label>
              ))}
            </div>
          </section>
        );
      })}

      <button type="button" data-testid="composition-save" disabled={!changed || save.isPending}
        className="px-3 py-1.5 text-xs font-black uppercase tracking-widest rounded-none border-2 border-foreground disabled:opacity-50"
        onClick={() => save.mutate(composition)}>
        {save.isPending ? "Saving…" : "Save composition"}
      </button>

      {/* Governance: how far down the scope hierarchy local variation of rulesets/settings/methodology is allowed. */}
      <DelegationPolicyAdmin />

      {/* Author a specific programme's/project's own tightened ruleset + allow-listed settings (within those limits). */}
      <ScopeOverrideAdmin />

      {/* One-click deploy — the inverse of hand-ticking items: turn a whole methodology (its screens,
          ruleset, business rules, settings + nomenclature) on in a single action. */}
      <MethodologyDeploy methodologies={presets.map((p) => ({ id: p.methodology, label: p.label }))} />
    </div>
  );
}
