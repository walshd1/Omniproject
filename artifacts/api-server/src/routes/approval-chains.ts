import { requireRole } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * Approval-chain DEFINITIONS — GET (any authenticated session, so the chains apply for everyone) and PUT
 * (pmo+; PMO authors org chains, and a PM authoring a project chain is a pmo-or-above act here). The
 * shape is validated in `updateSettings` → `validateApprovalChains`, so a malformed PUT is a 400 and
 * nothing persists. See docs/design/WORKFLOW-APPROVAL-CHAINS.md.
 *
 * NOTE (design §0 governing invariant): editing a chain can WEAKEN it (a security reduction), which the
 * invariant says needs dual-control. That per-edit tighten-vs-loosen gate is the documented follow-on
 * classification pass; today authoring is pmo-gated + version-audited like every other settings collection.
 */
export default settingsCollectionRouter({
  path: "/approval-chains",
  settingsKey: "approvalChains",
  versionLabel: "approval chains updated",
  writeGuards: [requireRole("pmo")],
});
