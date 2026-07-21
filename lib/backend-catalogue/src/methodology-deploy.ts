import { methodologyPack } from "./methodology-pack";
import { getMethodology, type MethodologyInvariant } from "./methodology-catalogue";
import { screenDefCatalogue } from "./screen-def-catalogue";
import { statusesForMethodology, prioritiesForMethodology } from "./work-vocabulary";
import type { ReferenceRuleset } from "./methodology-rulesets";

/**
 * METHODOLOGY DEPLOY — the pure resolver behind "one-click deploy this methodology". A methodology is a
 * cross-plane BUNDLE (methodologyPack collects its tagged views/reports/screens/routes + its ruleset); this
 * turns that bundle into the DEPLOY PLAN a scope (org / programme / project) is set to in one action:
 *
 *   - `compositionItemIds` — the methodology's OWN tagged surfaces as prefixed composition ids
 *     (`view:*` / `report:*` / `screen:*` / `ruleset:*`), matching the composition-item scheme. Adding these
 *     to a scope's methodology composition is what "turns the methodology on" — the screens/reports are
 *     already seeded; the composition curates which are live. (Neutral "*" items are always visible and are
 *     not part of a methodology's own set, so they're excluded.)
 *   - `ruleset` — the reference business-ruleset (modes + field rules) to apply.
 *   - `invariants` — the declarative cross-entity business rules to register (GTD next-action, …).
 *
 * PURE: it reads the catalogues + the def. The route that runs a deploy writes the composition at the scope,
 * applies the ruleset, and registers the invariants; keeping resolution pure keeps that route a thin shell.
 */

/** The NOMENCLATURE a methodology brings — its workflow states + ceremonies, and the status/priority tokens
 *  it relabels (the vocab tokens tagged with this methodology, `{ id, label }`). This is the "words" half of
 *  the bundle: deploying the methodology means a scope also speaks its language. */
export interface MethodologyNomenclature {
  states: string[];
  ceremonies: string[];
  statuses: Array<{ id: string; label: string }>;
  priorities: Array<{ id: string; label: string }>;
}

export interface MethodologyDeployment {
  methodologyId: string;
  label: string;
  /** The methodology's own tagged composition item ids (prefixed) — the set a deploy enables at the scope. */
  compositionItemIds: string[];
  /** The reference business-ruleset to apply (modes + field rules), or null when the methodology ships none. */
  ruleset: ReferenceRuleset | null;
  /** The declarative cross-entity invariants this methodology asserts (surfaced as compliance signals). */
  invariants: MethodologyInvariant[];
  /** The methodology's nomenclature — states/ceremonies + the status/priority tokens it relabels. */
  nomenclature: MethodologyNomenclature;
  /** Counts for a one-click confirmation summary ("turns on 1 screen, 1 ruleset, 1 business rule"). */
  summary: { views: number; reports: number; screens: number; invariants: number; hasRuleset: boolean };
}

/** A screen/report/view carries this methodology's OWN tag (not neutral "*"). */
const ownsTag = (methodologies: string[] | undefined, id: string): boolean =>
  !!methodologies && methodologies.includes(id);

/** Resolve the one-click deploy plan for a methodology, or null when the id is unknown. */
export function resolveMethodologyDeployment(methodologyId: string): MethodologyDeployment | null {
  const methodology = getMethodology(methodologyId);
  const pack = methodologyPack(methodologyId);
  if (!methodology || !pack) return null;

  // The methodology's own tagged surfaces, as prefixed composition ids. Screens come from BOTH the screen
  // catalogue (via the pack) and the panel-bearing def catalogue (the overview screens live there).
  const screenIds = new Set<string>(pack.screens.map((s) => s.id));
  for (const s of screenDefCatalogue()) {
    if (ownsTag((s as { methodologies?: string[] }).methodologies, methodologyId)) screenIds.add(s.id);
  }

  const compositionItemIds = [...new Set([
    ...pack.views.map((v) => `view:${v.id}`),
    ...pack.reports.map((r) => `report:${r.id}`),
    ...[...screenIds].map((id) => `screen:${id}`),
    ...(pack.ruleset ? [`ruleset:${pack.ruleset.id}`] : []),
  ])];
  const invariants = methodology.invariants ?? [];
  const nomenclature = {
    states: [...methodology.tools.states],
    ceremonies: [...methodology.tools.ceremonies],
    // The status/priority tokens this methodology relabels — its tagged vocab entries (+ the neutral ones it
    // inherits), as { id, label }. This is the "words" the deploy also lands.
    statuses: statusesForMethodology(methodologyId).map((s) => ({ id: s.id, label: s.label })),
    priorities: prioritiesForMethodology(methodologyId).map((p) => ({ id: p.id, label: p.label })),
  };

  return {
    methodologyId,
    label: methodology.label,
    compositionItemIds,
    ruleset: pack.ruleset,
    invariants,
    nomenclature,
    summary: {
      views: pack.views.length,
      reports: pack.reports.length,
      screens: screenIds.size,
      invariants: invariants.length,
      hasRuleset: !!pack.ruleset,
    },
  };
}
