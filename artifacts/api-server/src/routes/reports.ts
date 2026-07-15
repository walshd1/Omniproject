import { requireRole } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * The per-deployment REPORT DEFINITION store. GET (any authenticated session — the SPA reads it to render
 * the report catalogue) and PUT (pmo+; authoring the deployment's report set). Seeded from the built-in
 * catalogue at first boot, then deployment-owned JSON: each entry is a `ReportDefinition` bound to a
 * registered renderer, so a deployment adds / edits / removes reports as data, never in code. Validated in
 * `updateSettings` → `validateReports` (a malformed PUT is a 400, nothing persists). Presentation config,
 * not a security control, so a change applies immediately (no sign-off).
 */
export default settingsCollectionRouter({
  path: "/reports",
  settingsKey: "reports",
  versionLabel: "reports updated",
  writeGuards: [requireRole("pmo")],
});
