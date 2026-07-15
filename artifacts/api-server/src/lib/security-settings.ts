import { canonicalJson } from "./canonical-json";

/**
 * Security-posture classification of settings (design §0 + §6a). Every settings key is one of:
 *   1. a **choice** (no security dimension) — applies immediately, never gated (the majority);
 *   2. **security-relevant** — governed by the invariant: a change that REDUCES the posture needs a signed
 *      sign-off (≥2 distinct admins, degrading to a single admin's confirm+sign); a change that strengthens
 *      (or is neutral) applies immediately.
 *
 * A `SECURITY_SETTINGS` entry is a predicate returning TRUE when the change relaxes the posture. Where the
 * direction is ambiguous or the value is structurally complex, the predicate is `changed` (any edit is
 * treated as a relaxation — fail-CLOSED). Because a gate never blocks (it only asks for a signature — §0),
 * over-gating is safe: the worst case is a harmless extra signature, never a hole.
 *
 * The drift guard (security-settings.test) asserts EVERY `SettingsState` key is classified here, so a new
 * knob can't ship unclassified.
 */

type Val = unknown;

/** Deep-equality via canonical JSON — order-independent, prototype-safe. */
const same = (a: Val, b: Val): boolean => canonicalJson(a ?? null) === canonicalJson(b ?? null);
/** Any change at all counts as a relaxation (fail-closed for ambiguous/complex security settings). */
const changed = (a: Val, b: Val): boolean => !same(a, b);

/** A relaxation predicate: TRUE when moving old→new REDUCES the security posture. */
export type RelaxPredicate = (oldValue: Val, newValue: Val) => boolean;

/** Keys with a clear security dimension → the invariant applies. Value = "does this change relax?". */
export const SECURITY_SETTINGS: Record<string, RelaxPredicate> = {
  // Data-flow / trust roots — any change can redirect or expose data; fail-closed.
  brokerUrl: changed,
  backendSource: changed,
  oidcIssuerUrl: changed,
  selfHost: changed,
  // Egress / cross-instance data sharing.
  webhooks: changed,
  federatedPeers: changed,
  errorTelemetry: changed,
  // The controls themselves — weakening any is the classic insider move; fail-closed on any edit.
  approvalChains: changed,
  approvalBindings: changed,
  capabilityStates: changed,
  featureGovernance: changed,
  governanceRules: changed,
  loggingSync: changed,
  // Audit retention has a CLEAR scale: a shorter window loses audit trail (relax); longer strengthens (free).
  historyRetention: (o, n) => {
    const days = (v: Val): number => {
      const d = (v as { retentionDays?: unknown } | null | undefined)?.retentionDays;
      return typeof d === "number" ? d : Number.POSITIVE_INFINITY; // absent/null ⇒ "keep forever"
    };
    return days(n) < days(o); // shortening retention is the only relaxation
  },
};

/** Keys with NO security dimension — a "just a choice". Changes apply immediately, never gated. */
export const CHOICE_SETTINGS: readonly string[] = [
  // BrokerConfig (non-security)
  "brokerKinds", "fieldRouting", "customFields", "fieldValidation", "fieldOverrides",
  "programmeRegistry", "closedProjects", "guidAliases", "retiredGuids",
  // AiConfig
  "aiProvider", "sttProvider", "aiModel",
  // FinancialConfig
  "reportingCurrency", "fxRatePolicy", "fxRateAsOfDate", "priorityWeights", "usagePolicies",
  // IntegrationConfig
  "digestDelivery", "calendarPush",
  // GovernanceConfig (feature toggles — functional, not the governance controls)
  "disabledFeatures", "enabledFeatures", "programmeFeatures", "projectFeatures",
  // PresentationConfig (all presentation)
  "branding", "labelOverrides", "priorityLabels", "screenLayouts", "hiddenFields",
  "savedViews", "dashboards", "customReports", "reportOverrides", "methodologyComposition", "contentPages",
  // UserConfig
  "userPrefs",
  // PlatformConfig
  "skillsPlanning",
  // Workflows — the DEFINITION is authored config; its security is enforced at RUN time (approval binding +
  // the content-hash-bound responsibility acceptance that voids on edit, §4.2), not at the edit gate.
  "workflows",
];

/** Every classified key — the drift guard asserts this equals the full `SettingsState` key set. */
export const CLASSIFIED_KEYS: ReadonlySet<string> = new Set([...Object.keys(SECURITY_SETTINGS), ...CHOICE_SETTINGS]);

/**
 * The security-relevant keys in `patch` whose change RELAXES the posture vs `current`. Empty ⇒ the patch
 * either touches nothing security-relevant or only strengthens — so it may apply immediately. A non-empty
 * result must be routed to a signed sign-off before it applies. Pure.
 */
export function relaxingKeys(current: Record<string, Val>, patch: Record<string, Val>): string[] {
  const out: string[] = [];
  for (const key of Object.keys(patch)) {
    const predicate = SECURITY_SETTINGS[key];
    if (predicate && predicate(current[key], patch[key])) out.push(key);
  }
  return out;
}
