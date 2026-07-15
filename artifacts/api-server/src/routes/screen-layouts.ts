import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { requireRole } from "../lib/rbac";

/**
 * Per-screen saved LAYOUTS — the drag-customised arrangement (panel order / spans / hidden) an admin
 * or PMO applies to a generic ScreenRenderer screen. Keyed by screen id, so it's an OBJECT collection
 * (`Record<screenId, ScreenLayout>`) rather than a list — hence the `default: {}`. Like dashboards and
 * the other shared presentation config, these are customer-level (they ride the config-bundle snapshot),
 * READable by any authenticated session but WRITE-gated to `pmo` so a viewer / read-only token can't
 * rearrange shared screens. Never project data; the content on each panel is governed separately.
 */
export default settingsCollectionRouter({
  path: "/screen-layouts",
  settingsKey: "screenLayouts",
  versionLabel: "screen layouts updated",
  default: {},
  writeGuards: [requireRole("pmo")],
});
