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

/** The tagged assets collected for one methodology (everything but the ruleset,
 *  which is already Map-backed in methodology-rulesets). */
interface PackAssets {
  views: ViewDefinition[];
  reports: ReportDefinition[];
  screens: ScreenDefinition[];
  notificationRoutes: NotificationRoute[];
}

/**
 * A methodology-id → tagged-assets index, built ONCE (lazily) by a single pass over
 * each plane, rather than re-filtering every plane on each `methodologyPack` call.
 * An asset is bucketed under each distinct non-neutral tag it carries — the same
 * membership the old per-call `filter` tested — and assets are visited in plane
 * order, so each bucket matches that filter exactly (same contents, same order).
 */
let PACK_INDEX: Map<string, PackAssets> | null = null;

function packIndex(): Map<string, PackAssets> {
  if (PACK_INDEX) return PACK_INDEX;
  const index = new Map<string, PackAssets>();
  const bucket = (id: string): PackAssets => {
    let b = index.get(id);
    if (!b) { b = { views: [], reports: [], screens: [], notificationRoutes: [] }; index.set(id, b); }
    return b;
  };
  const tagsOf = (tags: string[] | undefined): string[] => [...new Set(tags ?? [])].filter((t) => t !== "*");
  for (const v of VIEWS) for (const t of tagsOf(v.methodologies)) bucket(t).views.push(v);
  for (const r of REPORTS) for (const t of tagsOf(r.methodologies)) bucket(t).reports.push(r);
  for (const s of SCREENS) for (const t of tagsOf(s.methodologies)) bucket(t).screens.push(s);
  for (const r of NOTIFICATION_ROUTES) for (const t of tagsOf(r.methodologies)) bucket(t).notificationRoutes.push(r);
  PACK_INDEX = index;
  return index;
}

/**
 * Assemble the pack for a methodology: its definition + every catalogue asset
 * carrying its tag (views, reports, screens, notification routes, ruleset). Returns
 * null for an unknown methodology.
 */
export function methodologyPack(id: string): MethodologyPack | null {
  const methodology = getMethodology(id);
  if (!methodology) return null;
  const assets = packIndex().get(id);
  return {
    methodology,
    views: assets ? assets.views.slice() : [],
    reports: assets ? assets.reports.slice() : [],
    screens: assets ? assets.screens.slice() : [],
    notificationRoutes: assets ? assets.notificationRoutes.slice() : [],
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
