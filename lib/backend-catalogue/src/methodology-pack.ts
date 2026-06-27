/**
 * METHODOLOGY PACKS — a methodology is a DERIVED grouping, not a plane: a "pack" is
 * the methodology's definition plus every asset that carries its methodology tag,
 * collected from across the catalogue. Because every plane is now JSON, a pack is a
 * portable bundle an operator can export from one deployment and drop into another's
 * config dir (`OMNI_CONFIG_DIR`) to reproduce the same look + rules.
 *
 * This module lives apart from `methodology-catalogue` (and is imported by neither
 * `view-catalogue` nor `methodology-rulesets`) so collecting a pack can pull from
 * all of them without an import cycle.
 */
import { getMethodology, METHODOLOGIES, type MethodologyDefinition } from "./methodology-catalogue";
import { VIEWS, type ViewDefinition } from "./view-catalogue";
import { REPORTS, type ReportDefinition } from "./report-catalogue";
import { SCREENS, type ScreenDefinition } from "./screen-catalogue";
import { NOTIFICATION_ROUTES, type NotificationRoute } from "./notification-routing";
import { getReferenceRuleset, type ReferenceRuleset } from "./methodology-rulesets";

export interface MethodologyPack {
  /** The methodology definition (states, ceremonies, capabilities). */
  methodology: MethodologyDefinition;
  /** Board views tagged with this methodology (the neutral "*" views are excluded —
   *  they ship regardless, so they aren't part of the pack). */
  views: ViewDefinition[];
  /** Reports tagged with this methodology. */
  reports: ReportDefinition[];
  /** Screens tagged with this methodology. */
  screens: ScreenDefinition[];
  /** Notification routing rules tagged with this methodology. */
  notificationRoutes: NotificationRoute[];
  /** The reference business-ruleset bundle for this methodology, if any. */
  ruleset: ReferenceRuleset | null;
}

/** True when an asset's methodology tags include this id specifically (NOT "*"). */
function taggedWith(tags: string[], id: string): boolean {
  return tags.includes(id);
}

/**
 * Assemble the pack for a methodology: its definition + every catalogue asset
 * carrying its tag (views, reports, screens, notification routes, ruleset). Returns
 * null for an unknown methodology.
 */
export function methodologyPack(id: string): MethodologyPack | null {
  const methodology = getMethodology(id);
  if (!methodology) return null;
  return {
    methodology,
    views: VIEWS.filter((v) => taggedWith(v.methodologies, id)),
    reports: REPORTS.filter((r) => !!r.methodologies && taggedWith(r.methodologies, id)),
    screens: SCREENS.filter((s) => !!s.methodologies && taggedWith(s.methodologies, id)),
    notificationRoutes: NOTIFICATION_ROUTES.filter((r) => taggedWith(r.methodologies, id)),
    ruleset: getReferenceRuleset(id) ?? null,
  };
}

/**
 * The complete methodology picker list — the DERIVED set spanning every plane: the
 * defined methodologies PLUS any methodology any asset (view/report/screen/route)
 * tags itself with, neutral-free and deduped. A methodology is now a cross-plane
 * derived grouping, not a standalone plane — this is the single source for "what
 * methodologies can a user pick?".
 */
export function allMethodologyTags(): string[] {
  const out = new Set<string>();
  const add = (tags: string[] | undefined): void => { for (const t of tags ?? []) if (t !== "*") out.add(t); };
  for (const v of VIEWS) add(v.methodologies);
  for (const r of REPORTS) add(r.methodologies);
  for (const s of SCREENS) add(s.methodologies);
  for (const r of NOTIFICATION_ROUTES) add(r.methodologies);
  // The defined methodologies are always pickable, even if nothing tags them yet.
  for (const m of METHODOLOGIES) out.add(m.id);
  return [...out].sort();
}
