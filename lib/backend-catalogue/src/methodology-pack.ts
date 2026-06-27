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
import { getMethodology, type MethodologyDefinition } from "./methodology-catalogue";
import { VIEWS, type ViewDefinition } from "./view-catalogue";
import { NOTIFICATION_ROUTES, type NotificationRoute } from "./notification-routing";
import { getReferenceRuleset, type ReferenceRuleset } from "./methodology-rulesets";

export interface MethodologyPack {
  /** The methodology definition (states, ceremonies, capabilities). */
  methodology: MethodologyDefinition;
  /** Board views tagged with this methodology (the neutral "*" views are excluded —
   *  they ship regardless, so they aren't part of the pack). */
  views: ViewDefinition[];
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
 * carrying its tag. Returns null for an unknown methodology. Note: reports + screens
 * don't carry methodology tags yet, so they aren't in the pack (see asset
 * selectability / presets work).
 */
export function methodologyPack(id: string): MethodologyPack | null {
  const methodology = getMethodology(id);
  if (!methodology) return null;
  return {
    methodology,
    views: VIEWS.filter((v) => taggedWith(v.methodologies, id)),
    notificationRoutes: NOTIFICATION_ROUTES.filter((r) => taggedWith(r.methodologies, id)),
    ruleset: getReferenceRuleset(id) ?? null,
  };
}
