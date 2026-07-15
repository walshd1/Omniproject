import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { requireAnyRole } from "../lib/rbac";

/**
 * The OFF switch for screens. An admin or PMO turns a screen off for the deployment and its id is stored
 * here; the SPA hides it from nav and the builder renders a "turned off" state instead of it. The companion
 * to the override store (routes/screen-defs) — together they back the Screens admin panel. READ open (the
 * SPA needs it); WRITE gated to admin OR pmo (the two authorities that own screen configuration).
 */
export default settingsCollectionRouter({
  path: "/disabled-screens",
  settingsKey: "disabledScreens",
  versionLabel: "disabled screens updated",
  writeGuards: [requireAnyRole("admin", "pmo")],
});
