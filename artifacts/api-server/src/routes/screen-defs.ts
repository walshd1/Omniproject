import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { requireAnyRole } from "../lib/rbac";

/**
 * Org-authored SCREEN DEFINITIONS store. A PMO builds a screen from scratch (or modifies one of the shipped
 * defaults) and it is persisted here, in the per-deployment (encrypted/sealed) config store, then merged by
 * the SPA over its built-in screen catalogue — an org def OVERRIDES a built-in of the same id, or adds a new
 * screen. This is also how a new methodology arrives: a JSON bundle of tagged screen defs pushed into this
 * field. READable by any authenticated session (the SPA needs it to render); WRITES gated to `pmo`, like the
 * sibling shared-config collections, so a viewer / read-only token can't rewrite an org's screens.
 */
export default settingsCollectionRouter({
  path: "/screen-defs",
  settingsKey: "screenDefs",
  versionLabel: "screen defs updated",
  writeGuards: [requireAnyRole("admin", "pmo")],
});
