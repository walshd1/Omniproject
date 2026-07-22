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
  // (`selfHost` moved to the `self-host` CHOICE config def — Phase C. Its real gate is the data-responsibility
  //  acknowledgement on the setup route, not a sign-off; the `changed` classification here only ever guarded the
  //  bulk PATCH /settings backdoor, which can no longer reach it once it leaves settings.)
  // Egress / cross-instance data sharing. DIRECTIONAL: opening a NEW active egress target (a webhook to a
  // new/redirected url, a peer at a new baseUrl) is the relaxation; removing/deactivating one strengthens
  // and applies immediately (the invariant lets you increase posture freely). A same-target credential
  // rotation or a metadata edit (label/description) is neutral — not gated.
  webhooks: (o, n) => {
    const activeUrls = (v: Val): Set<string> => new Set(
      (Array.isArray(v) ? v : []).filter((w) => w && (w as { active?: unknown }).active !== false).map((w) => String((w as { url?: unknown }).url)),
    );
    const before = activeUrls(o);
    return [...activeUrls(n)].some((u) => !before.has(u)); // any newly-active egress url ⇒ relax
  },
  federatedPeers: (o, n) => {
    const activeBases = (v: Val): Set<string> => new Set(
      (Array.isArray(v) ? v : []).filter((p) => p && (p as { active?: unknown }).active !== false).map((p) => String((p as { baseUrl?: unknown }).baseUrl)),
    );
    const before = activeBases(o);
    return [...activeBases(n)].some((b) => !before.has(b)); // any newly-active peer target ⇒ relax
  },
  // (`errorTelemetry` + `loggingSync` egress toggles moved to the `error-telemetry` / `logging-sync` config
  //  defs — their relaxation predicates live in `security-config`, evaluated by the floor gate. Roadmap Phase C.)
  // The controls themselves — weakening any is the classic insider move; fail-closed on any edit.
  approvalChains: changed,
  approvalBindings: changed,
  featureGovernance: changed,
  governanceRules: changed,
  // AI responsibility acceptances grant an AI approval authority — directional: a NEW/changed acceptance
  // (a new workflow authorized, or a re-sign at a different hash) expands autonomous reach → relax;
  // revoking one strengthens → immediate. Set only via the passkey-signed acceptance route (the bulk PATCH
  // refuses it), so this classification is belt-and-suspenders for the drift guard + any future path.
  workflowAcceptances: (o, n) => {
    const key = (a: { workflowId?: unknown; workflowHash?: unknown }): string => `${String(a.workflowId)}@${String(a.workflowHash)}`;
    const before = new Set((Array.isArray(o) ? o : []).map((a) => key(a as { workflowId?: unknown; workflowHash?: unknown })));
    return (Array.isArray(n) ? n : []).some((a) => !before.has(key(a as { workflowId?: unknown; workflowHash?: unknown })));
  },
  // Capability exposure has a clear ladder (off < user-defined < public). RAISING a capability's exposure —
  // or pointing it at a NEW/changed egress endpoint, or raising any per-surface exposure — is the
  // relaxation; turning it off/down (or dropping the endpoint) strengthens and applies immediately.
  capabilityStates: (o, n) => {
    const rank = (s: unknown): number => (s === "public" ? 2 : s === "user-defined" ? 1 : 0);
    const map = (v: Val): Record<string, { state?: unknown; endpoint?: unknown; surfaces?: Record<string, unknown> }> =>
      (v && typeof v === "object" ? (v as Record<string, { state?: unknown; endpoint?: unknown; surfaces?: Record<string, unknown> }>) : {});
    const oldMap = map(o);
    for (const [id, ns] of Object.entries(map(n))) {
      const os = oldMap[id];
      if (rank(ns?.state) > rank(os?.state)) return true;                           // more exposed
      if (ns?.endpoint && ns.endpoint !== os?.endpoint) return true;                 // new/changed egress endpoint
      for (const [k, v] of Object.entries(ns?.surfaces ?? {})) {
        if (rank(v) > rank((os?.surfaces ?? {})[k])) return true;                    // a surface got more exposed
      }
    }
    return false;
  },
  // Audit retention has a CLEAR scale: a shorter window loses audit trail (relax); longer strengthens (free).
  // (`historyRetention` moved to the `history-retention` config def — its shortening-is-a-relaxation predicate
  //  lives in `security-config`, evaluated by the floor gate. Roadmap Phase C.)
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
  "screenLayouts",
  "dashboards", "customReports", "reportOverrides", "reports", "resourceAllocations", "budgetPlans", "contentPages",
  // Editable-screens config — org-authored screen defs/content + on-screen registers. All presentation:
  // screen definitions, the on/off list, per-collection edit policy, the saved pivot views, and the RACI /
  // stakeholder register content. None is a fail-closed security control (edit access is content
  // authorization, tuned freely by admins), so each is a choice, not a sign-off-gated security setting.
  "screenDefs", "forms",
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
