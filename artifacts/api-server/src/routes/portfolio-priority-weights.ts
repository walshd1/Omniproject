import { DEFAULT_PRIORITY_WEIGHTS } from "../lib/settings";
import { requireRole } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * Portfolio prioritisation scoring weights (backlog #98) — the ONLY configurable part of the
 * fund/rank/defer view. The score itself is computed live over the read model (RICE/WSJF/MoSCoW/
 * strategic-goal/benefits canonical fields) on every request by the SPA's lib/portfolio-priority.ts;
 * nothing is persisted here except how much each dimension counts. Any authenticated user may READ
 * (so the ranking renders identically for everyone); tuning the weights is PMO-gated, since it is
 * shared org config that changes which projects rise to the top. Mirrors routes/custom-reports.ts.
 */
export default settingsCollectionRouter({
  path: "/portfolio/priority-weights",
  settingsKey: "priorityWeights",
  versionLabel: "portfolio priority weights updated",
  default: DEFAULT_PRIORITY_WEIGHTS,
  writeGuards: [requireRole("pmo")],
});
