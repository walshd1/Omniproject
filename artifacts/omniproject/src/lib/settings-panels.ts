/**
 * The ordered Settings admin-panel keys — the single light source the command palette uses to offer
 * a DIRECT jump to any panel (⌘K → panel = exactly 2 actions, satisfying the ≤2-actions rule for the
 * ~46 settings panels that were otherwise a scroll-and-hunt away). Kept in sync with
 * `ADMIN_PANELS` in `pages/Settings.tsx` by a drift-guard test. Deliberately holds NO component
 * imports, so pulling it into the palette doesn't drag the whole Settings bundle into that chunk.
 */
export const SETTINGS_PANEL_KEYS = [
  "loggingSync", "errorTelemetry", "customFields", "routingMatrix", "fieldValidation", "programmeRegistry",
  "brokerKinds", "closedProjects", "guidAliases", "selfHostCapabilities", "translationLayer", "brokerLog",
  "premium", "securityKeys", "nlCommand", "healthWatch", "copilot", "portfolioInsights", "estimateAssistant",
  "rebalancePanel", "provenanceDashboard", "deploymentProfile", "featureModules", "featureGovernance",
  "rateCard", "scopeUplift", "rateGrid", "identityMap", "costRules", "budgetPlans", "resourceAllocations",
  "raci", "stakeholders", "forms", "screens", "customReports", "customBackend",
  "contentPages", "priorityWeights", "federatedPeers", "governanceRules", "fieldVisibility",
  "governanceDashboard", "governance", "aiProviders", "actionCatalogue", "a11y", "calendarPush", "labels",
  "priorityLabels", "viewBuilder", "methodologyComposer", "performance", "usageLimits",
] as const;

export type SettingsPanelKey = (typeof SETTINGS_PANEL_KEYS)[number];

/** The DOM id used to anchor a settings panel (so the palette can scroll it into view). */
export const settingsAnchorId = (key: string): string => `set-${key}`;

/** Acronyms/initialisms that should keep their canonical casing in a human label. */
const ACRONYMS: Record<string, string> = {
  ai: "AI", db: "DB", sso: "SSO", scim: "SCIM", idp: "IdP", pmo: "PMO", rbac: "RBAC",
  evm: "EVM", raid: "RAID", fx: "FX", api: "API", kms: "KMS", guid: "GUID", nl: "NL", url: "URL",
  a11y: "Accessibility",
};

/**
 * A human-readable label for a panel key — split camelCase, title-case each word, and upper-case
 * known acronyms (aiProviders → "AI Providers", nlCommand → "NL Command"). The palette's fuzzy
 * search covers any imperfect derivation, so this needs no hand-maintained label table.
 */
export function settingsPanelLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .map((w) => ACRONYMS[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
