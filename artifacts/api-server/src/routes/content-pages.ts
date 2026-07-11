import { requireRole } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * Content pages — named, ordered lists of unified-library component ids (reports + widgets, see
 * @workspace/backend-catalogue componentsFor("content")) a customer composes into free-form content,
 * rendered through the generic content-page renderer. Customer-level presentation config — a page is a
 * list of ids, never project data — and rides the snapshot/export bundle. Any authenticated user may
 * READ them (so a saved page renders for everyone); authoring is PMO-gated, since a content page is
 * shared org config. Same persistence shape as routes/custom-reports. Validated in updateSettings.
 */
export default settingsCollectionRouter({
  path: "/content-pages",
  settingsKey: "contentPages",
  versionLabel: "content pages updated",
  writeGuards: [requireRole("pmo")],
});
