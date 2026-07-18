/**
 * Gateway-local settings store.
 *
 * These configure the gateway itself (which broker URL to call, which AI
 * provider to use, etc.) and so are NOT brokered through the broker. In a multi-replica
 * deployment back this with a shared store (Redis/Postgres); the in-memory store
 * is sufficient for single-instance and demo use.
 */

import { assertSafeOutboundUrl, isSafeOutboundUrl, UnsafeUrlError } from "./url-safety";
import { DEPLOYMENT_PROFILES, setRuntimeProfile, type DeploymentProfile } from "./deployment-profile";
import { evaluateConstraints } from "./settings-constraints";
import { settingsPreset } from "./settings-presets";
import type { BackendFieldMap } from "../broker/types";
import type { GovernanceRule } from "./governance-rules";
import { validatePredicate } from "./predicate";
import { isValidCadence, type SnapshotCadence } from "../history/cadence";
import { logger } from "./logger";
import { envInt } from "./env-config";
import { validateFieldRouting, FieldRoutingError, type FieldRoute } from "./field-routing";
import { validateApprovalChains, ApprovalChainError, type ChainDef } from "./approval-chain";
import { validateApprovalBindings, ApprovalBindingError, type ApprovalBinding } from "./approval-binding";
import { validateWorkflows, WorkflowError, type WorkflowDef } from "./workflow";
import { validateWorkflowAcceptances, ResponsibilityAcceptanceError, type WorkflowAcceptance } from "./responsibility-acceptance";
import { validateResourceAllocations, ResourceAllocationError, type ResourceAllocation } from "./resource-allocation";
import { validateBudgetPlans, BudgetPlanError, type BudgetPlan } from "./budget-plan";
import { validateScreenDefs, ScreenDefError, type OrgScreenDef } from "./screen-def";
import { FormDefError, type FormDef } from "./form-def";
import { reportCatalogue, type ReportDefinition } from "@workspace/backend-catalogue";
import { validateCustomFields, validateCustomFieldSources, CustomFieldError, type CustomField } from "./custom-fields";
import { sanitizeUserPrefs } from "./user-prefs";
import { sanitizeGrant } from "./calendar-push";
import { isForbiddenKey, stripDangerousKeysDeep } from "./safe-json";
import { validateFieldValidation, FieldValidationError, type FieldValidationRule } from "./field-validation";
import { validateProgrammeRegistry, ProgrammeRegistryError, type ProgrammeRegistry } from "./programmes";
import type { UsagePolicy } from "./usage-metering";
import { validateBrokerKinds, brokerKindsFromEnv, BrokerKindsError } from "./broker-kinds";
import { validateClosedProjects, ClosedProjectError, type ClosedProjectRegistry } from "./closed-projects";
import { validateGuidAliases, GuidAliasError, type GuidAliases } from "./guid-aliases";

function coerceProfile(raw: unknown): DeploymentProfile | undefined {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (DEPLOYMENT_PROFILES as readonly string[]).includes(v) ? (v as DeploymentProfile) : undefined;
}

export const AI_PROVIDERS = ["none", "openai", "ollama", "anthropic", "openrouter", "openai-compatible"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Coerce an untrusted value (env or request) to a valid AiProvider, else "none". */
function coerceAiProvider(raw: unknown): AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(raw as string) ? (raw as AiProvider) : "none";
}

/**
 * FX as-of-date policy for multi-currency consolidation:
 *  - "spot"        — convert at today's live rate (the broker's current snapshot). Default.
 *  - "periodClose" — convert at the rate as of `fxRateAsOfDate` (e.g. the reporting period's close
 *                    date), so a board pack matches the rate finance closed the books at, not
 *                    whatever the market does today.
 *  - "budgetRate"  — convert at the rate as of `fxRateAsOfDate` treated as the rate the budget was
 *                    SET at (e.g. the fiscal year's opening rate), so variance isn't polluted by FX
 *                    drift. Mechanically the same read as periodClose (both ask the broker for a
 *                    rate "as of" a date) — the distinct id exists so the UI/label can say which
 *                    convention a board pack used.
 * Historical lookup is opportunistic: a broker that can't serve a rate for an arbitrary past date
 * (the reference/demo brokers can't) degrades to its current live snapshot — never cached or
 * stored, still read live every request.
 */
export const FX_RATE_POLICIES = ["spot", "periodClose", "budgetRate"] as const;
export type FxRatePolicy = (typeof FX_RATE_POLICIES)[number];

function coerceFxRatePolicy(raw: unknown): FxRatePolicy {
  return (FX_RATE_POLICIES as readonly string[]).includes(raw as string) ? (raw as FxRatePolicy) : "spot";
}

/** AI-assisted speech-to-text engines. "browser" = the device's own recogniser (local,
 *  zero audio egress); "whisper" = an OpenAI-compatible /audio/transcriptions endpoint
 *  (self-hosted Whisper server OR a cloud one). Whisper is just one provider. */
export const STT_PROVIDERS = ["none", "browser", "whisper"] as const;
export type SttProvider = (typeof STT_PROVIDERS)[number];

function coerceSttProvider(raw: unknown): SttProvider {
  return (STT_PROVIDERS as readonly string[]).includes(raw as string) ? (raw as SttProvider) : "none";
}

/** Thrown when an admin settings write fails validation; the route maps it to 400. */
export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}
// Free-form backend routing hint passed to the broker. "all" = no filter (whatever
// the broker is wired to). No specific backend (Plane/OpenProject/…) is required.
export type BackendSource = string;

/** White-label branding (premium: gated by the `branding` entitlement). */
export interface BrandingConfig {
  appName: string | null;
  shortName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  loginHeading: string | null;
  footerText: string | null;
  supportUrl: string | null;
  /** Theme: base font family applied to all screens (a CSS font-family stack).
   *  Font SIZE and background COLOUR are per-user (client-side a11y prefs), not here. */
  fontFamily: string | null;
}

/** Outbound webhook subscription (premium: gated by the `webhooks` entitlement). */
export interface WebhookSubscription {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  description?: string | undefined;
}

/**
 * A federated peer — another OmniProject instance (typically a sibling deployment for a different
 * region/subsidiary under per-country data residency, see docs/DATA-RESIDENCY.md) this instance may
 * query for a consolidated portfolio view. `baseUrl` is the peer's own origin; `token` is the bearer
 * credential this instance presents, which must be one of the PEER's own `API_TOKENS` (see
 * lib/api-token.ts) — no new cross-instance auth scheme, just this instance acting as a read-only API
 * client of the peer, exactly like a BI tool would. `region` is a free-form label (e.g. "eu", "us") shown
 * in the federated view so a contribution is always attributable, never silently blended. Same trust
 * class as an outbound webhook target: config (a URL + a credential), never project data.
 */
export interface PeerInstance {
  id: string;
  label: string;
  baseUrl: string;
  token: string;
  region: string | null;
  active: boolean;
}

/**
 * Opt-in state-history egress to an operator-owned logging server. OFF by
 * default. This is the ONE deliberate relaxation of OmniProject's "nothing
 * leaves" posture — the same trust class as the OData/Prometheus/Power-BI feeds:
 * data egresses, by explicit admin choice, to a destination the operator controls
 * and is responsible for. Enabling it unlocks historical time-travel. The
 * operator must acknowledge that egressed data is outside OmniProject's warranty.
 */
export interface LoggingSyncConfig {
  enabled: boolean;
  url: string | null;
  /** The admin acknowledged that egressed data leaves OmniProject's warranty. */
  acknowledgedWarranty: boolean;
}


/**
 * Self-host DB adoption — the operator's choice to let OmniProject's OWN database become a
 * system-of-record (or an augmenting store) for a slice of the work-item superset. Same "disclose,
 * don't insure" trust class as `loggingSync`: adopting it moves the only copy of some data into
 * infrastructure OmniProject neither operates nor backs up nor warrants, so it can only be turned on
 * with an explicit data-responsibility acknowledgement. `adopted` is the org-level opt-in set of
 * gated `selfhost:<domain>` domains (core domains are implicit). See selfhost/setup-wizard.
 */
export interface SelfHostConfig {
  mode: "off" | "augmenting" | "system-of-record";
  /** Gated domain ids opted into at org level (e.g. "financials", "quality"). Core is implicit. */
  adopted: string[];
  /** The admin acknowledged that self-host data is theirs to own, secure and back up. */
  acknowledgedDataResponsibility: boolean;
}

const SELF_HOST_MODES = ["off", "augmenting", "system-of-record"] as const;
const DEFAULT_SELF_HOST: SelfHostConfig = { mode: "off", adopted: [], acknowledgedDataResponsibility: false };

/** Optional above-the-seam email delivery for the scheduled digests. */
export interface DigestDeliveryConfig {
  /** Email addresses that receive the proactive/exec digest (in addition to the notify-bus dispatch).
   *  Empty ⇒ no email delivery (the default). */
  emailRecipients: string[];
}

// Cap on digest email recipients (compliance/blast-radius bound). Tunable via DIGEST_MAX_RECIPIENTS.
const MAX_DIGEST_RECIPIENTS = envInt("DIGEST_MAX_RECIPIENTS", 100, { min: 1 });
/** Seed recipients from `DIGEST_EMAIL_RECIPIENTS` (comma-separated) so an operator can wire it via env. */
function digestDeliveryFromEnv(): DigestDeliveryConfig {
  const raw = process.env["DIGEST_EMAIL_RECIPIENTS"]?.trim();
  const emailRecipients = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_DIGEST_RECIPIENTS)
    : [];
  return { emailRecipients };
}

/**
 * History-retention config — the snapshot cadence for the durable time-series behind trend analysis.
 * Operator-confirmed posture: **infinite snapshot retention** (never pruned) and a **variable cadence
 * gated by admin (the org default) + PMO (per-programme/project overrides)** — see history/cadence.
 * Config only (cadence policy), never project data; rides the snapshot/export bundle.
 */
export interface HistoryRetentionSettings {
  /** Admin: org-wide default cadence. */
  orgDefault: SnapshotCadence;
  /** PMO: per-programme cadence overrides, keyed by programmeId. */
  programme: Record<string, SnapshotCadence>;
  /** PMO/PM: per-project cadence overrides, keyed by projectId. */
  project: Record<string, SnapshotCadence>;
  /**
   * DISPOSAL window in days: snapshots/journal older than this become prunable by the disposal job
   * (`POST /history/dispose`). Absent/null ⇒ INFINITE retention — the historical default, so an
   * existing config is unchanged. Set a positive integer to satisfy a storage-limitation policy.
   */
  retentionDays?: number | null;
  /**
   * LEGAL-HOLD keys (`"entity#id"`) that are exempt from BOTH disposal and erasure until explicitly
   * released — a litigation/investigation hold that overrides the retention window and any DSAR delete.
   */
  legalHolds?: string[];
}

const DEFAULT_HISTORY_RETENTION: HistoryRetentionSettings = {
  orgDefault: { kind: "interval", everyHours: 24 },
  programme: {},
  project: {},
};

/**
 * Skills matrix + demand — PLANNING CONFIG (like rate cards / cost rules / priority weights): the
 * resource→skill proficiencies and the role/skill demand requests the skills-capacity report matches.
 * Config, not project data — rides the snapshot/export bundle, admin/PMO edited. Skills aren't a
 * canonical work-item field, so this is the deployment's source of truth for them.
 */
export interface SkillResource {
  resourceId: string;
  name: string;
  role?: string;
  /** skill → proficiency 1–5. */
  skills: Record<string, number>;
  capacityHours: number;
}
export interface SkillDemandItem {
  id: string;
  initiative: string;
  skill: string;
  hoursNeeded: number;
  minProficiency?: number;
}
export interface SkillsPlanningSettings {
  matrix: SkillResource[];
  demand: SkillDemandItem[];
}

/**
 * A programme's or project's feature policy in the org→programme→project gating model. Disable-only
 * for the everyday narrowing, plus `required`/`forbidden` for PMO governance mandates ("must use" /
 * "must not use") — all resolved by lib/feature-resolution. Lists of catalogue ids (features ∪
 * methodologies ∪ reports).
 */
export interface ScopeFeatureConfig {
  /** Soft: turned off for this scope + descendants (within the parent's allowed set). */
  disabled: string[];
  /** Hard mandate: forced on + locked for this scope + descendants. */
  required: string[];
  /** Hard mandate: forced off + locked for this scope + descendants. */
  forbidden: string[];
}

/**
 * `SettingsState` is composed FLAT from the cohesive sub-configs below (`interface … extends …`).
 * The runtime shape is a single flat object — identical to before — so `getSettings().backendSource`
 * still works and nothing downstream changes; the split only gives each concern a named home so a
 * change to one area (say dashboards) no longer means scrolling past unrelated fields (say FX policy).
 */

/** Broker / backend data plane: which backend, the field-routing matrix, admin custom fields +
 *  validation, capability-map overrides, and the project-identity registries (programmes, closed-
 *  project locations, GUID aliases, retirement tombstones). */
export interface BrokerConfig {
  /** The active broker's webhook/endpoint URL (n8n by default). */
  brokerUrl: string | null;
  backendSource: BackendSource;
  /** Admin-managed extra connected broker kinds (beyond the active data hop), unioned with the
   *  BROKER_KINDS env in the registry. See lib/broker-kinds + broker/registry. */
  brokerKinds: string[];
  /** The field-routing matrix: which source (vendor·broker·sourceField) feeds which UI element.
   *  One-to-one at both ends (anti-collision) — see lib/field-routing. */
  fieldRouting: FieldRoute[];
  /** Approval-chain definitions (org/project-scoped), authored by PMO/PM. See docs/design/WORKFLOW-APPROVAL-CHAINS.md. */
  approvalChains: ChainDef[];
  /** Which action ids are gated by which chain (action → chainId). Empty ⇒ nothing is chain-gated. */
  approvalBindings: ApprovalBinding[];
  /** Admin/PMO/PM-authored workflows (org/project-scoped), stored as JSON. See docs/design/WORKFLOW-APPROVAL-CHAINS.md. */
  workflows: WorkflowDef[];
  /** Standing, passkey-signed human responsibility acceptances that authorize an AI to approve a specific
   *  workflow VERSION (content-hash-bound; voided by any edit or the signer's offboarding). §4.2. */
  workflowAcceptances: WorkflowAcceptance[];
  /** Admin-defined fields extending the reference superset. Each must be mapped in `fieldRouting`
   *  (route it to the Postgres backend if there's no external source) — see lib/custom-fields. */
  customFields: CustomField[];
  /** Per-field data validation rules (min/max, pattern, allowed set, required) — see
   *  lib/field-validation. Definitions here; enforced against values on the write path. */
  fieldValidation: FieldValidationRule[];
  /**
   * Admin translation-layer overrides: per-field / per-entity surface+store that
   * REPLACE the broker-derived/declared capability map. Lets an admin correct a
   * mis-mapped field (e.g. force a field the auto-derivation hid back on, or hide
   * one the backend exposes but shouldn't). Config, never project data.
   */
  fieldOverrides: BackendFieldMap;
  /** Admin/PMO-managed programme registry: programmeId → { name, instanceIds } — the source of truth
   *  for programme membership (a project belongs by its `omniInstanceId`). See lib/programmes. */
  programmeRegistry: ProgrammeRegistry;
  /** Closed-project LOCATION index: projectGuid → where its data now lives (sor | archive). Lets closed
   *  projects be retained + retrieved without re-pulling them through the live broker. See
   *  lib/closed-projects. */
  closedProjects: ClosedProjectRegistry;
  /** GUID translation for relinked projects: oldGuid → newGuid, so references to a superseded GUID
   *  resolve to the project's current identity. See lib/guid-aliases. */
  guidAliases: GuidAliases;
  /** RETIRED project GUIDs — a deleted/forgotten project's GUID, tombstoned so it can never silently
   *  reactivate (suppressed from live reads). Reactivation requires an explicit re-link to a NEW GUID.
   *  See lib/project-forget. */
  retiredGuids: string[];
}

/** AI / STT providers + the governed-capability states (AI tools, MCP, providers and vendors). */
export interface AiConfig {
  aiProvider: AiProvider;
  sttProvider: SttProvider;
  aiModel: string | null;
  /**
   * Admin data-governance for the governed capabilities (AI tools, the MCP, AI
   * providers and vendors), keyed by capability id. Off by default; the admin sets
   * each to off / user-defined / public (and, for AI tools, per-surface). Customer-
   * level config — rides the snapshot/export — never project data.
   */
  capabilityStates: Record<string, CapabilitySetting>;
}

/** Multi-currency consolidation policy + the portfolio-prioritisation scoring weights. */
export interface FinancialConfig {
  /** Default ISO 4217 reporting currency for consolidated financial reports (null ⇒ use the FX base). */
  reportingCurrency: string | null;
  /** Which FX rate a consolidated report converts at: today's spot rate, or a rate "as of"
   *  `fxRateAsOfDate` (period-close or the rate the budget was set at). See `FxRatePolicy`. */
  fxRatePolicy: FxRatePolicy;
  /** ISO 8601 date the "as of" rate is read for when `fxRatePolicy` isn't "spot". Ignored (falls
   *  back to spot) when null or when `fxRatePolicy` is "spot". */
  fxRateAsOfDate: string | null;
  /**
   * Portfolio prioritisation scoring weights (backlog #98): how much RICE / WSJF / MoSCoW /
   * strategic-goal contribution / benefits realisation each count toward a project's rank score.
   * ONLY the formula weights are config — the score itself is computed live over the read model on
   * every request, never persisted. Customer-level config; rides the snapshot/export. See
   * routes/portfolio-priority-weights + the SPA PortfolioPrioritisation report.
   */
  priorityWeights: PriorityWeights;
  /** Admin-entered per-vendor usage governance: an optional volume LIMIT + unit COST per external
   *  vendor, so the usage screen can show cost totals and warn at 50/75/90/100% of a limit. Config
   *  only — the counters themselves live in the shared-state seam (lib/usage-metering). */
  usagePolicies?: Record<string, UsagePolicy>;
}

/** Outbound integrations: OIDC issuer, webhooks, federated peers, digest email, calendar push,
 *  and self-host DB adoption. Config only (URLs + credentials), never project data. */
export interface IntegrationConfig {
  oidcIssuerUrl: string | null;
  /** Outbound webhook subscriptions. */
  webhooks: WebhookSubscription[];
  /**
   * Other OmniProject instances this deployment can fan out to for a federated portfolio view
   * (backlog #135). Config only — URLs + bearer credentials, never project data. See
   * routes/federated-peers + lib/federation.
   */
  federatedPeers: PeerInstance[];
  /** Optional above-the-seam email delivery of the scheduled digests (proactive + exec), to a fixed
   *  operator-configured recipient list, IN ADDITION to the notify-bus dispatch. Off unless SMTP is
   *  configured AND at least one recipient is set. Config only — addresses, never project data. */
  digestDelivery: DigestDeliveryConfig;
  /** Per-user calendar-push consent (keyed by `sub`); default not-granted. */
  calendarPush: Record<string, CalendarPushGrant>;
  /** Opt-in self-host DB adoption (off by default; needs a data-responsibility ack to enable). */
  selfHost: SelfHostConfig;
}

/** State-history egress + durable snapshot retention. */
export interface HistoryConfig {
  /** Opt-in state-history egress to an operator-owned logging server (off by default). */
  loggingSync: LoggingSyncConfig;
  /** Snapshot cadence for durable history retention (admin org default + PMO scope overrides). */
  historyRetention: HistoryRetentionSettings;
}

/** Feature governance: the opt-out/opt-in feature sets and the PMO org/programme/project mandates. */
export interface GovernanceConfig {
  /**
   * Opt-OUT list of feature-module ids the operator has switched off (everything is on by
   * default). A module disabled at startup is never loaded (its route chunk is skipped); a
   * runtime disable makes it 404 at once. Customer-level config — rides the snapshot/export so
   * the chosen module set travels in the bundle — never project data. See lib/feature-modules.
   */
  disabledFeatures: string[];
  /**
   * Org opt-IN list for `defaultOff` feature ids (presence, predictivePrefetch, …). A default-off
   * feature stays off for everyone until its id is here — the safety/cost/storage opt-in. Customer-level
   * config; rides the snapshot/export. See lib/feature-resolution.
   */
  enabledFeatures: string[];
  /**
   * Org-level PMO governance: catalogue ids every programme/project MUST use (`required`) or MUST NOT
   * use (`forbidden`) — hard mandates that lock all descendants. Customer-level config. See
   * lib/feature-resolution.
   */
  featureGovernance: { required: string[]; forbidden: string[] };
  /** Per-programme feature policy (disable/require/forbid), keyed by programmeId. ⊆ the org-approved set. */
  programmeFeatures: Record<string, ScopeFeatureConfig>;
  /** Per-project feature policy (disable/require/forbid), keyed by projectId. ⊆ the programme/org set. */
  projectFeatures: Record<string, ScopeFeatureConfig>;
  /**
   * Conditional governance rules (PMO): a mandate that applies only WHEN its predicate matches (e.g.
   * `projectType != small-internal`). Folded into the org-level overrides at resolution time, so they
   * can only restrict (require/forbid/disable) for the contexts they match — never grant beyond org.
   */
  governanceRules: GovernanceRule[];
}

/** Presentation / curation config: branding, labels, screen layouts, saved views, dashboards,
 *  custom + built-in reports, content pages, hidden fields and the methodology composition. */
export interface PresentationConfig {
  // NB these presentation configs are NOT settings keys — each moved into the composition model as a
  // scope-layered config def (see lib/scoped-config + the matching lib/route):
  //   • white-label `branding`            → lib/branding (env default beneath the org config def)
  //   • company-nomenclature `labelOverrides` (`label-overrides`) → lib/labels
  //   • org accessibility `accessibilityDefaults` (`accessibility-defaults`) → lib/user-prefs + routes/accessibility
  //   • custom `priorityLabels` (`priority-labels`) → routes/priority-labels
  /**
   * Per-screen layout overrides (drag-arranged panel order / spans / hidden), keyed
   * by screen id. Presentation config — part of the snapshot/export so it travels in
   * the customer's config JSON. Never project data.
   */
  screenLayouts: Record<string, ScreenLayout>;
  // NB the view-curation hidden-field list is NOT a settings key — it moved into the composition model as a
  // config-def-backed collection (`hidden-fields`, via settingsCollectionRouter's config mode; see lib/availability).
  // NB saved views are NOT a settings key — they moved into the composition model as a config-def-backed
  // collection (`saved-views`, via settingsCollectionRouter's config mode; see routes/views).
  /**
   * Named custom dashboards: an ordered list of widget instances chosen from the widget catalogue.
   * Customer-level presentation config — rides the snapshot/export so dashboards travel in the
   * bundle — never project data. See routes/dashboards + the SPA dashboards feature module.
   */
  dashboards: Dashboard[];
  /**
   * Customer-authored bespoke reports (the report generator): each is a data-driven definition —
   * source scope, a predicate filter, a group-by field and aggregated metrics + a viz — rendered
   * through a generic renderer with no code. Presentation config; rides the snapshot/export, never
   * project data. See routes/custom-reports + the SPA customReports feature module.
   */
  customReports: CustomReportDef[];
  /**
   * Metadata overrides for the BUILT-IN reports (the catalogue). Presentation-only: a per-report-id
   * override of label / order / visibility, merged over the shipped catalogue so a customer can rename,
   * reorder or hide a built-in report without a rebuild. Never changes a report's rendering (that's code)
   * and never holds project data. Rides the snapshot/export. See routes/report-overrides.
   */
  reportOverrides: ReportOverride[];
  /**
   * The deployment's effective set of report DEFINITIONS (the per-deployment JSON store). Seeded from the
   * built-in catalogue at first boot, then owned by the deployment: a report is a JSON definition
   * (`ReportDefinition`) bound to a registered renderer, so a deployment can add / edit / remove reports as
   * data — nothing about a report lives in code except its reusable renderer component. Presentation config;
   * rides the snapshot/export, never project data. See routes/reports + report-renderers on the SPA.
   */
  reports: ReportDefinition[];
  /** Resource bookings — a named person committed to a project for hours over a period (the write side of
   *  resource management). Stored as JSON in the deployment config. See routes/resource-allocations. */
  resourceAllocations: ResourceAllocation[];
  /** Multi-year / period budget PLANS — an editable time-phased budget per project (the planning side of
   *  financials, above actuals + forecast). Stored as JSON. See routes/budget-plans. */
  budgetPlans: BudgetPlan[];
  // NB the RACI + stakeholder registers are NOT settings keys — they moved into the composition model as
  // config-def-backed collections (`raci` / `stakeholders`, via settingsCollectionRouter's config mode; see
  // routes/raci + routes/stakeholders).
  /** Intake / request FORMS — admin/PMO-authored forms (typed fields + a target project); the `form` panel
   *  renders them and each submission becomes a work item through the broker. See routes/forms. */
  forms: FormDef[];
  // NB automation recipes + project templates are NOT settings keys — they moved into the composition model as
  // config-def-backed collections (`automations` / `templates`, via settingsCollectionRouter's config mode; see
  // routes/automations + routes/templates).
  /** Org-authored SCREEN DEFINITIONS — a PMO's built-from-scratch or modified screens, stored in the
   *  (encrypted) deployment config to OVERRIDE a shipped default (matched by id) or add net-new screens;
   *  also the delivery vehicle for a new-methodology JSON bundle. The SPA merges these over its built-in
   *  screen catalogue and renders them through the one generic builder. See routes/screen-defs. */
  screenDefs: OrgScreenDef[];
  // NB these are NOT settings keys — each moved into the composition model as a config-def-backed collection
  // (via settingsCollectionRouter's config mode): `disabled-screens` (routes/disabled-screens),
  // `collection-edit-roles` (routes/collection-edit-roles; read by lib/collection-edit-policy) and
  // `panel-views` (routes/panel-views).
  // NB the methodology composition is NOT a settings key — it moved into the composition model as a nullable
  // config-def-backed collection (`methodology-composition`; see lib/scoped-config + routes/methodology-composition).
  /**
   * Named content pages: an ordered, flat list of unified-library component ids (reports + widgets,
   * see @workspace/backend-catalogue componentsFor("content")) a customer composes into free-form
   * content, rendered through the generic content-page renderer. Same shared-config shape as
   * customReports — customer-level presentation config, rides the snapshot/export, never project
   * data. See routes/content-pages + the SPA contentPages feature module.
   */
  contentPages: ContentPageDef[];
}

/** Per-user personal config (keyed by the user's `sub`): accessibility UI preferences. */
export interface UserConfig {
  /**
   * Per-user UI preferences (accessibility: text size, background colour, contrast,
   * motion), keyed by the user's `sub`. Stored as JSON with code defaults so a
   * person's setup PERSISTS ACROSS SESSIONS and devices — important for users with
   * dyslexia / visual impairment. Personal config, never project data.
   */
  userPrefs: Record<string, UserPrefs>;
}

/** Platform-level odds and ends: deployment profile, error telemetry opt-in, skills planning. */
// NB the working-time policy for the scheduling engine is NOT a settings key — it moved into the composition
// model as a scope-layered `scheduling` config def (see lib/scoped-config + routes/scheduling).
export interface PlatformConfig {
  /** Deployment context chosen in the setup wizard (relaxes enterprise couplings by choice). */
  deploymentProfile?: DeploymentProfile;
  /** Skills matrix + demand for the skills-capacity report (planning config, admin/PMO edited). */
  skillsPlanning: SkillsPlanningSettings;
}

/**
 * Gateway-local settings — the flat composition of every sub-config above. Adding a field means
 * adding it to the relevant sub-config here AND to FIELD_DESCRIPTORS (which drives the store seed,
 * the writable-key allow-list, and validation from one place).
 */
export interface SettingsState
  extends BrokerConfig,
    AiConfig,
    FinancialConfig,
    IntegrationConfig,
    HistoryConfig,
    GovernanceConfig,
    PresentationConfig,
    UserConfig,
    PlatformConfig {}

/** Relative weights for the five prioritisation dimensions — not required to sum to 100 (the scorer
 *  renormalises over whichever dimensions a project actually reports). Mirrored in the SPA's
 *  lib/portfolio-priority.ts (no shared package between the two apps, same as CustomReportDef). */
export interface PriorityWeights {
  rice: number;
  wsjf: number;
  moscow: number;
  strategic: number;
  benefit: number;
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = { rice: 25, wsjf: 25, moscow: 15, strategic: 15, benefit: 20 };

/** A named saved view: which columns, sort, filters and grouping to apply (all optional, so a view
 *  can capture just a column set or just a sort). `scope` ties it to a surface (e.g. "grid"). */
export interface SavedView {
  id: string;
  name: string;
  scope?: string;
  /** Which entity a view-engine view targets ("task" | "issue"); omitted for legacy grid views. */
  entity?: string;
  /** How the view engine renders it ("list" | "board" | "table" | "timeline" | "chart"); omitted = list. */
  viewKind?: string;
  /** For a timeline view: the date field that buckets records. */
  dateField?: string;
  /** For a chart view: how the chart draws the records. */
  chart?: { type?: string; groupField?: string; startField?: string; endField?: string };
  /** Visible canonical field keys, in display order. */
  columns?: string[];
  sort?: { field: string; dir: "asc" | "desc" };
  filters?: { field: string; value: string }[];
  groupBy?: string;
  /** Optional presentation styling for the rendered view (title/font/colours/background). */
  style?: ArtifactStyle;
}

/**
 * A saved PANEL VIEW — a named pivot/period preset a user has captured off a table/chart panel's control
 * bar. `screen`+`panel` scope it to the panel it was saved from; `state` is the exact control state
 * (group dimension, aggregation, per-field filter selections) to re-apply. Shared, customer-level config.
 */
export interface PanelView {
  id: string;
  label: string;
  /** The screen id the source panel lives on. */
  screen: string;
  /** The panel id within that screen. */
  panel: string;
  /** The control state to re-apply: group dimension, aggregation, and per-field filter selections. */
  state: { groupBy: string; agg: string; filters: Record<string, string[]> };
}

/**
 * Presentation styling a user attaches to a rendered artifact (view/report/chart). Mirrors the SPA's
 * StyleSpec (no shared package between the two apps). Fonts are a fixed named set; colours are plain CSS
 * strings, length-capped so a shared, customer-level definition can't carry an unbounded payload.
 */
export interface ArtifactStyle {
  title?: string;
  subtitle?: string;
  fontFamily?: "sans" | "serif" | "mono";
  textColor?: string;
  background?: string;
  align?: "left" | "center";
}

/** One placed widget on a custom dashboard. `type` keys into the SPA widget catalogue; `span` is
 *  the column width (1–3) on the responsive grid; `title` optionally overrides the widget label. */
export interface DashboardWidget {
  id: string;
  type: string;
  span?: 1 | 2 | 3;
  title?: string;
}

/** A named custom dashboard: an ordered list of widget instances. `refreshMs`, when set, makes the
 *  dashboard auto-refresh its read-model data on that interval (a dashboard is a report that refreshes
 *  in real time) — a client-side poll, never a new write surface. */
export interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  refreshMs?: number;
}

/** The aggregations a custom-report metric may apply over a field. */
export type CustomReportAgg = "sum" | "avg" | "count" | "min" | "max";

/** One aggregated column in a bespoke report (e.g. sum of `budget`). */
export interface CustomReportMetric {
  id: string;
  field: string;
  agg: CustomReportAgg;
  label?: string;
}

/**
 * A customer-authored report definition (the report generator). Rendered through a generic renderer:
 * filter the work items, group by a field (optionally a second level for a cross-tab), aggregate the
 * chosen metrics, draw a table, bar chart or month-bucketed trend line. `filter` is a predicate
 * condition set (the same engine the rules use); kept loosely typed here and validated at the route.
 * Never holds project data — only field keys + how to summarise them.
 */
export interface CustomReportDef {
  id: string;
  label: string;
  /** "project" renders per selected project; "portfolio" rolls up across all projects' issues;
   *  "tasks" reports over the GTD task entity (portfolio-wide). */
  scope: "project" | "portfolio" | "tasks";
  groupBy?: string;
  /** Second group-by level (pivot columns) — ignored without `groupBy`, and for `viz: "line"`. */
  groupBy2?: string;
  metrics: CustomReportMetric[];
  filter?: { all?: unknown[]; any?: unknown[] };
  viz: "table" | "bar" | "line" | "area" | "pie";
  /** Required for `viz: "line" | "area"`: a date field bucketed by month to build a time trend. */
  dateField?: string;
  /** Chart options (the chart editor): stacked series and legend visibility. */
  chart?: { stacked?: boolean; legend?: boolean };
  /** Optional presentation styling for the rendered report (title/font/colours/background). */
  style?: ArtifactStyle;
}

/**
 * A metadata override for one built-in (catalogue) report, keyed by its report id. All fields optional:
 * an override may set just a new label, just an order, or just hide the report. Merged over the catalogue
 * on the client; presentation-only, never touches rendering or data.
 */
export interface ReportOverride {
  id: string;
  label?: string;
  /** Display order in the report picker (overrides the catalogue order). */
  order?: number;
  /** Hide the built-in report from the picker/page without removing it from the catalogue. */
  hidden?: boolean;
}

/**
 * A named content page: a flat, ordered list of unified-library component ids ("report:evm",
 * "widget:portfolioHealth", …) rendered one after another. Deliberately minimal — no layout engine,
 * no per-instance overrides — a content page is "pick components, put them in order". Each
 * component's own `refresh` (see LibraryComponent) drives its polling; the page adds nothing on top.
 */
export interface ContentPageDef {
  id: string;
  name: string;
  /** Library component ids, in display order (e.g. ["report:evm", "widget:portfolioHealth"]). */
  componentIds: string[];
}

/** One user's persisted UI/accessibility preferences. */
export interface UserPrefs {
  fontScale: number;
  /** Per-user font family override, or null to inherit the company brand font. */
  fontFamily: "sans" | "serif" | "mono" | null;
  /** Per-user accent colour (hex), or null to inherit the company brand accent. */
  accentColor: string | null;
  backgroundColor: string | null;
  highContrast: boolean;
  /** Colour-overlay tint (dyslexia / Irlen reading aid) + its colour. */
  tint: boolean;
  tintColor: string;
  reduceMotion: boolean;
  /** Switch-access scanning: off, single-switch (auto-scan) or two-switch (step). */
  switchScan: "off" | "single" | "two";
  /** Auto-scan dwell time per item, ms (single-switch only). */
  scanRateMs: number;
  /** Verbose live-region announcements to aid screen-reader users. */
  screenReader: boolean;
  /** Show the dictation mic (on-device speech-to-text via the user's own browser). */
  speechInput: boolean;
  /** Touch-optimised mobile layout: follow the device (auto) or force on/off. */
  mobileMode: "auto" | "on" | "off";
  /** UI spacing density: comfortable (default) or compact. */
  density: "comfortable" | "compact";
  /**
   * SAVED per-screen / per-artifact theme overrides, keyed by scope id (e.g. "screen:reports"
   * or "artifact:report:<id>"). Each is a partial theme that overrides the user's GLOBAL override
   * for that one surface. Session-only scoped tweaks live in the browser and are never sent here.
   */
  scopedOverrides: Record<string, ScopedThemeOverride>;
}

/** A saved theme override for one screen/artifact. All fields optional; absent = inherit the layer below. */
export interface ScopedThemeOverride {
  fontFamily?: "sans" | "serif" | "mono" | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
}

/**
 * A user's EXPLICIT permission for their schedule to be pushed to an external calendar. Default is
 * NOT granted — nothing is ever pushed until the user turns this on. The gateway holds only this
 * consent flag + target choice; it never holds an OAuth credential. The actual event upsert is
 * performed by the calendar connection/MCP the user authorises, which consumes the grant-gated feed.
 */
export interface CalendarPushGrant {
  /** The user has explicitly authorised calendar push. */
  granted: boolean;
  /** Where to push (the catalogued calendar output id), or null. */
  target: "google-calendar" | "outlook-calendar" | null;
  /** Which items: the user's own assignments ("mine") or everything in their scope ("all"). */
  scope: "mine" | "all";
  /** When consent was last granted (ISO), or null. */
  grantedAt: string | null;
}

/**
 * The deployment state of a governed capability (an AI tool, the MCP, an AI provider
 * or a vendor):
 *   - "off"          — not used.
 *   - "user-defined" — runs somewhere the CUSTOMER controls: truly local (on-device /
 *                      in-cluster) or a customer-owned remote endpoint. Private.
 *   - "public"       — a third-party SaaS provider.
 * Each capability advertises only the states it actually supports; the UI offers those.
 */
export type DeploymentState = "off" | "user-defined" | "public";

/** An admin's chosen state for one governed capability (customer-level JSON). */
export interface CapabilitySetting {
  /** The chosen state. Ignored (treated as "off") if the capability can't support it. */
  state: DeploymentState;
  /** For "user-defined": the customer's own endpoint (local or remote). */
  endpoint?: string | null;
  /**
   * Per-surface overrides for AI tools — a screen/context id → state. Lets one piece
   * of AI be set differently per screen (e.g. TTS public everywhere but "user-defined"
   * or "off" on the finance screen). Only honoured for surface-aware capabilities.
   */
  surfaces?: Record<string, DeploymentState>;
}

/** A saved arrangement for one screen. */
export interface ScreenLayout {
  /** Panel ids in display order (panels not listed keep their original order, after). */
  order?: string[];
  /** Per-panel grid span override (1–12). */
  spans?: Record<string, number>;
  /** Panel ids hidden from this screen. */
  hidden?: string[];
}

function webhooksFromEnv(): WebhookSubscription[] {
  const raw = process.env["WEBHOOKS"]?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((w): w is Record<string, unknown> => !!w && typeof w === "object")
      .map((w, i) => ({
        id: typeof w["id"] === "string" ? (w["id"] as string) : `env-${i + 1}`,
        url: String(w["url"] ?? ""),
        secret: typeof w["secret"] === "string" ? (w["secret"] as string) : "",
        events: Array.isArray(w["events"]) ? (w["events"] as unknown[]).map(String) : ["*"],
        active: w["active"] !== false,
        description: typeof w["description"] === "string" ? (w["description"] as string) : undefined,
      }))
      // Apply the SAME safety check as admin writes, so an env-seeded unsafe URL
      // (e.g. a link-local/metadata target) is dropped at load rather than being
      // admitted here and then blocking every later validated webhook mutation.
      .filter((w) => isSafeOutboundUrl(w.url));
  } catch (err) {
    logger.warn({ err }, "WEBHOOKS is not valid JSON — ignoring, no webhooks seeded from env");
    return [];
  }
}

function peersFromEnv(): PeerInstance[] {
  const raw = process.env["FEDERATED_PEERS"]?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p, i) => ({
        id: typeof p["id"] === "string" ? (p["id"] as string) : `env-${i + 1}`,
        label: typeof p["label"] === "string" && p["label"] ? (p["label"] as string) : `Peer ${i + 1}`,
        baseUrl: String(p["baseUrl"] ?? ""),
        token: typeof p["token"] === "string" ? (p["token"] as string) : "",
        region: typeof p["region"] === "string" ? (p["region"] as string) : null,
        active: p["active"] !== false,
      }))
      // Same safety check as admin writes (see webhooksFromEnv for the same rationale).
      .filter((p) => isSafeOutboundUrl(p.baseUrl));
  } catch (err) {
    logger.warn({ err }, "FEDERATED_PEERS is not valid JSON — ignoring, no federated peers seeded from env");
    return [];
  }
}

function loggingSyncFromEnv(): LoggingSyncConfig {
  const url = process.env["LOGGING_SYNC_URL"]?.trim() || null;
  // Env-provided config is operator-trusted; still drop an unsafe URL and only
  // enable when the warranty was explicitly acknowledged via env.
  const ack = process.env["LOGGING_SYNC_ACK_WARRANTY"] === "true";
  const safe = url ? isSafeOutboundUrl(url) : false;
  return {
    enabled: !!url && safe && ack,
    url: safe ? url : null,
    acknowledgedWarranty: ack,
  };
}

/** Feature-module ids disabled via env (`DISABLED_FEATURES=odata,integrations`). */
function disabledFeaturesFromEnv(): string[] {
  return (process.env["DISABLED_FEATURES"]?.trim() || "").split(/[\s,]+/).filter(Boolean);
}

/** Org opt-IN for default-off features (env seed; admin extends via settings). */
function enabledFeaturesFromEnv(): string[] {
  return (process.env["ENABLED_FEATURES"]?.trim() || "").split(/[\s,]+/).filter(Boolean);
}

const initialProfile = coerceProfile(process.env["DEPLOYMENT_PROFILE"]);

// ── Field registry ──────────────────────────────────────────────────────────────
// ONE descriptor per persisted setting drives the three things that used to be maintained
// separately — and drifted, which is why a bespoke compile-time guard had to exist: the env-seeded
// store default, the writable-key allow-list, and the bulk-PATCH validator. Adding a field now means
// adding ONE entry here; the `{ [K in keyof SettingsState]: … }` type makes a missing field a compile
// error, so the store, ALLOWED_KEYS and validatePatch can never again disagree about which fields
// exist (the old `_MissingSettingsKeys` guard is gone — the mapped type IS the guard).

/** How one setting is seeded, allow-listed, and validated. `validate` runs on the bulk-PATCH /
 *  config-restore path: it returns the value to persist (possibly normalised) or throws
 *  SettingsValidationError. CROSS-field rules (customFields↔routing, closedProjects↔retiredGuids)
 *  are separate explicit post-validators in validatePatch — a per-field descriptor can't see its
 *  siblings. */
interface FieldDescriptor<K extends keyof SettingsState> {
  seed: () => SettingsState[K];
  validate: (value: unknown) => SettingsState[K];
}

/** Validator for a value confined to a fixed set of strings. `nullable` also accepts null/undefined
 *  (the field left unset), matching the old `!= null && !valid → throw` deployment-profile check. */
function enumField<T extends string>(field: string, values: readonly T[], opts: { nullable?: boolean } = {}) {
  return (value: unknown): T => {
    if (opts.nullable && value == null) return value as unknown as T;
    if (!(values as readonly unknown[]).includes(value)) {
      throw new SettingsValidationError(`${field} must be one of: ${values.join(", ")}`);
    }
    return value as T;
  };
}

/** Validator for an outbound URL string (or null): must be a string and pass the SSRF/egress guard. */
function urlField(field: string) {
  return (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value !== "string") throw new SettingsValidationError(`${field} must be a string or null`);
    try {
      assertSafeOutboundUrl(value, field);
    } catch (err) {
      throw new SettingsValidationError(err instanceof UnsafeUrlError ? err.message : `${field} is invalid`);
    }
    return value;
  };
}

/** Validator for a `string[]` field (rejects non-arrays / non-string members). */
export function stringArrayField(field: string) {
  return (value: unknown): string[] => {
    if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) {
      throw new SettingsValidationError(`${field} must be an array of strings`);
    }
    return value as string[];
  };
}

/** Adapt a validator that only THROWS on bad input (no normalisation) into a descriptor validator —
 *  persists the dangerous-key-stripped value verbatim, exactly as the old `if (k in patch) checkX(...)`. */
export function shapeChecked<T>(assert: (value: unknown) => void) {
  return (value: unknown): T => {
    assert(value);
    return value as T;
  };
}

/** Adapt a validator that RETURNS a normalised value and throws a typed error, mapping that error to
 *  the standard settings 400 (SettingsValidationError) while letting anything else propagate. */
export function normalisedBy<T>(run: (value: unknown) => T, ErrorClass: new (...args: never[]) => Error) {
  return (value: unknown): T => {
    try {
      return run(value);
    } catch (e) {
      if (e instanceof ErrorClass) throw new SettingsValidationError((e as Error).message);
      throw e;
    }
  };
}

const FIELD_DESCRIPTORS: { [K in keyof SettingsState]: FieldDescriptor<K> } = {
  brokerUrl: { seed: () => process.env["BROKER_URL"]?.trim() || null, validate: urlField("brokerUrl") },
  aiProvider: { seed: () => coerceAiProvider(process.env["AI_PROVIDER"]?.trim() || "none"), validate: enumField("aiProvider", AI_PROVIDERS) },
  sttProvider: { seed: () => coerceSttProvider(process.env["STT_PROVIDER"]?.trim() || "none"), validate: enumField("sttProvider", STT_PROVIDERS) },
  deploymentProfile: { seed: () => initialProfile, validate: enumField("deploymentProfile", DEPLOYMENT_PROFILES, { nullable: true }) },
  aiModel: {
    seed: () => process.env["AI_MODEL"] ?? null,
    validate: (value) => {
      if (value != null && typeof value !== "string") throw new SettingsValidationError("aiModel must be a string or null");
      return (value ?? null) as string | null;
    },
  },
  backendSource: {
    seed: () => process.env["BACKEND_SOURCE"]?.trim() || "all",
    validate: (value) => {
      if (typeof value !== "string") throw new SettingsValidationError("backendSource must be a string");
      return value;
    },
  },
  reportingCurrency: {
    seed: () => process.env["REPORTING_CURRENCY"]?.trim().toUpperCase() || null,
    validate: (value) => {
      if (value == null) return null;
      if (typeof value !== "string" || (value !== "" && !/^[A-Za-z]{3}$/.test(value))) {
        throw new SettingsValidationError("reportingCurrency must be a 3-letter ISO 4217 code (or null to clear)");
      }
      return value.toUpperCase() || null;
    },
  },
  fxRatePolicy: { seed: () => coerceFxRatePolicy(process.env["FX_RATE_POLICY"]?.trim()), validate: enumField("fxRatePolicy", FX_RATE_POLICIES) },
  fxRateAsOfDate: {
    seed: () => process.env["FX_RATE_AS_OF_DATE"]?.trim() || null,
    validate: (value) => {
      if (value == null) return null;
      if (typeof value !== "string" || (value !== "" && Number.isNaN(Date.parse(value)))) {
        throw new SettingsValidationError("fxRateAsOfDate must be an ISO 8601 date string (or null to clear)");
      }
      return value || null;
    },
  },
  oidcIssuerUrl: { seed: () => process.env["OIDC_ISSUER_URL"] ?? null, validate: urlField("oidcIssuerUrl") },
  fieldRouting: {
    // Anti-collision (one source → one UI element, both ways) lives in field-routing; surface its error
    // as the standard settings 400, and persist the normalised (trimmed) map.
    seed: () => [],
    validate: normalisedBy((v) => validateFieldRouting(v), FieldRoutingError),
  },
  customFields: { seed: () => [], validate: normalisedBy((v) => validateCustomFields(v), CustomFieldError) },
  approvalChains: { seed: () => [], validate: normalisedBy((v) => validateApprovalChains(v), ApprovalChainError) },
  approvalBindings: { seed: () => [], validate: normalisedBy((v) => validateApprovalBindings(v), ApprovalBindingError) },
  workflows: { seed: () => [], validate: normalisedBy((v) => validateWorkflows(v), WorkflowError) },
  workflowAcceptances: { seed: () => [], validate: normalisedBy((v) => validateWorkflowAcceptances(v), ResponsibilityAcceptanceError) },
  fieldValidation: {
    // Validate the rule DEFINITIONS (shape + patterns compile); values are enforced on the write path.
    seed: () => [],
    validate: normalisedBy((v) => validateFieldValidation(v), FieldValidationError),
  },
  programmeRegistry: { seed: () => ({}), validate: normalisedBy((v) => validateProgrammeRegistry(v), ProgrammeRegistryError) },
  brokerKinds: {
    seed: () => brokerKindsFromEnv(), // env SEEDS the default; the setting owns it thereafter
    validate: normalisedBy((v) => validateBrokerKinds(v), BrokerKindsError),
  },
  closedProjects: { seed: () => ({}), validate: normalisedBy((v) => validateClosedProjects(v), ClosedProjectError) },
  guidAliases: { seed: () => ({}), validate: normalisedBy((v) => validateGuidAliases(v), GuidAliasError) },
  retiredGuids: {
    seed: () => [],
    validate: (value) => {
      if (!isStringArray(value)) throw new SettingsValidationError("retiredGuids must be an array of strings");
      return [...new Set((value as string[]).map((g) => g.trim()).filter(Boolean))];
    },
  },
  webhooks: { seed: () => webhooksFromEnv(), validate: shapeChecked(validateWebhooks) },
  federatedPeers: { seed: () => peersFromEnv(), validate: shapeChecked(validateFederatedPeers) },
  loggingSync: { seed: () => loggingSyncFromEnv(), validate: shapeChecked(validateLoggingSync) },
  selfHost: { seed: () => ({ ...DEFAULT_SELF_HOST }), validate: shapeChecked(validateSelfHost) },
  historyRetention: { seed: () => ({ ...DEFAULT_HISTORY_RETENTION }), validate: shapeChecked(validateHistoryRetention) },
  digestDelivery: { seed: () => digestDeliveryFromEnv(), validate: shapeChecked(validateDigestDelivery) },
  skillsPlanning: { seed: () => ({ matrix: [], demand: [] }), validate: shapeChecked(validateSkillsPlanning) },
  fieldOverrides: { seed: () => ({ fields: {}, entities: {} }), validate: shapeChecked(validateFieldOverrides) },
  screenLayouts: {
    seed: () => ({}),
    validate: (value) => {
      if (typeof value !== "object" || value == null || Array.isArray(value)) throw new SettingsValidationError("screenLayouts must be an object");
      return validateScreenLayouts(value as Record<string, unknown>);
    },
  },
  userPrefs: {
    // Per-user accessibility prefs are written verbatim + read back raw, so sanitize every entry through
    // the same clamps its dedicated route uses; drop forbidden keys.
    seed: () => ({}),
    validate: (value) => {
      if (typeof value !== "object" || value == null || Array.isArray(value)) throw new SettingsValidationError("userPrefs must be an object");
      const clean: Record<string, UserPrefs> = {};
      for (const [sub, p] of Object.entries(value as Record<string, unknown>)) if (!isForbiddenKey(sub)) clean[sub] = sanitizeUserPrefs(p);
      return clean;
    },
  },
  calendarPush: {
    // Per-user calendar consent: sanitize every entry (the consent invariant + server-stamped grantedAt)
    // so a bulk PATCH can't forge a "granted" consent for another user's sub.
    seed: () => ({}),
    validate: (value) => {
      if (typeof value !== "object" || value == null || Array.isArray(value)) throw new SettingsValidationError("calendarPush must be an object");
      const nowIso = new Date().toISOString();
      const clean: Record<string, CalendarPushGrant> = {};
      for (const [sub, g] of Object.entries(value as Record<string, unknown>)) if (!isForbiddenKey(sub)) clean[sub] = sanitizeGrant(g, nowIso);
      return clean;
    },
  },
  capabilityStates: {
    // capabilityStates has a dedicated, step-up'd admin route running each entry through
    // sanitizeCapabilitySetting. A bulk PATCH / config restore reaches the SAME stored map, so it must
    // apply the SAME per-entry guards (via the injected sanitizer); the shape-check stays the floor for
    // the test-only case where governance hasn't registered it yet.
    seed: () => ({}),
    validate: (value) => {
      if (typeof value !== "object" || value == null || Array.isArray(value)) throw new SettingsValidationError("capabilityStates must be an object");
      return (capabilityStatesSanitizer ? capabilityStatesSanitizer(value as Record<string, unknown>) : (value as Record<string, unknown>)) as Record<string, CapabilitySetting>;
    },
  },
  disabledFeatures: { seed: () => disabledFeaturesFromEnv(), validate: stringArrayField("disabledFeatures") },
  enabledFeatures: { seed: () => enabledFeaturesFromEnv(), validate: stringArrayField("enabledFeatures") },
  featureGovernance: { seed: () => ({ required: [], forbidden: [] }), validate: shapeChecked((v) => validateGovernance(v, "featureGovernance")) },
  programmeFeatures: { seed: () => ({}), validate: shapeChecked((v) => validateScopeFeatureMap(v, "programmeFeatures")) },
  projectFeatures: { seed: () => ({}), validate: shapeChecked((v) => validateScopeFeatureMap(v, "projectFeatures")) },
  governanceRules: { seed: () => [], validate: shapeChecked((v) => validateGovernanceRules(v, "governanceRules")) },
  customReports: { seed: () => [], validate: shapeChecked(validateCustomReports) },
  reportOverrides: { seed: () => [], validate: shapeChecked(validateReportOverrides) },
  // The per-deployment report store — seeded from the built-in catalogue, then deployment-owned JSON.
  reports: { seed: () => reportCatalogue() as unknown as ReportDefinition[], validate: shapeChecked(validateReports) },
  resourceAllocations: { seed: () => [], validate: normalisedBy((v) => validateResourceAllocations(v), ResourceAllocationError) },
  budgetPlans: { seed: () => [], validate: normalisedBy((v) => validateBudgetPlans(v), BudgetPlanError) },
  screenDefs: { seed: () => [], validate: normalisedBy((v) => validateScreenDefs(v), ScreenDefError) },
  forms: { seed: () => [], validate: normalisedBy((v) => { if (!Array.isArray(v)) throw new FormDefError("forms must be an array"); return v as FormDef[]; }, FormDefError) },
  dashboards: { seed: () => [], validate: shapeChecked(validateDashboards) },
  contentPages: { seed: () => [], validate: shapeChecked(validateContentPages) },
  priorityWeights: { seed: () => ({ ...DEFAULT_PRIORITY_WEIGHTS }), validate: shapeChecked(validatePriorityWeights) },
  usagePolicies: { seed: () => ({}), validate: shapeChecked(validateUsagePolicies) },
};

// The mutable in-memory store, seeded once from the descriptors. An undefined seed (deploymentProfile
// when no profile is configured) is OMITTED rather than stored as `undefined` — exactOptionalPropertyTypes.
const store: SettingsState = (() => {
  const seeded: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(FIELD_DESCRIPTORS)) {
    const value = descriptor.seed();
    if (value !== undefined) seeded[key] = value;
  }
  return seeded as unknown as SettingsState;
})();

/** True when historical time-travel is available (operator opted into egress). */
export function isTimeTravelEnabled(): boolean {
  return store.loggingSync.enabled;
}

// The writable-key allow-list, DERIVED from the field registry so it can never drift from the store
// seed or the validators (which is what retired the bespoke `_MissingSettingsKeys` compile-time guard
// this used to need: with one source of truth there are no longer three lists to keep in sync).
// Exported so the settings-sanitizer coverage ratchet (settings-sanitizer-coverage.test.ts) can iterate
// EVERY persisted field and prove none is a prototype-pollution / dangerous-key sink on the bulk-PATCH
// path — a new field is automatically probed, no per-field test to remember.
export const ALLOWED_KEYS = Object.keys(FIELD_DESCRIPTORS) as (keyof SettingsState)[];

// A FROZEN read snapshot of the store, rebuilt ONLY on write (updateSettings is the sole mutator).
// getSettings() returns it directly: reads are hot (100+ call sites, several per request) while writes
// are rare, so this removes a large per-call shallow-copy allocation. Frozen ⇒ a caller that tries to
// mutate the result fails fast (a bonus mutation poka-yoke) instead of silently corrupting the store —
// no read site mutates it. `store` stays the mutable source of truth for internal writes.
let snapshot: SettingsState = Object.freeze({ ...store });

/** The current in-memory settings — a shared FROZEN snapshot, rebuilt only when settings change. */
export function getSettings(): SettingsState {
  return snapshot;
}

/** Rebuild the read snapshot after a store mutation (called by updateSettings, the only writer). */
function refreshSettingsSnapshot(): void {
  snapshot = Object.freeze({ ...store });
}

/**
 * A read-safe view of settings for the GET endpoint. `GET /settings` is readable
 * by any authenticated session — including read-only API tokens — so webhook
 * signing secrets must never be returned over it. Masks them; everything else
 * (which the admin UI needs) is preserved.
 */
export function redactSettingsForRead(s: SettingsState): SettingsState {
  return {
    ...s,
    webhooks: s.webhooks.map((w) => ({ ...w, secret: w.secret ? "********" : "" })),
    federatedPeers: (s.federatedPeers ?? []).map((p) => ({ ...p, token: p.token ? "********" : "" })),
  };
}

/**
 * Validate an untrusted settings patch before it is written. Only the fields
 * present in the patch are checked. Throws `SettingsValidationError` on the first
 * problem so the route can answer 400 instead of persisting a malformed config
 * (e.g. an `aiProvider` the AI layer can't resolve, or an unsafe outbound URL).
 */
/** A map of key → {surface, store} booleans, or throw. */
function validateSupportMap(value: unknown, what: string): void {
  if (typeof value !== "object" || value == null) throw new SettingsValidationError(`fieldOverrides.${what} must be an object`);
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (!v || typeof v !== "object") throw new SettingsValidationError(`each ${what} override must be an object`);
    const { surface, store } = v as Record<string, unknown>;
    if (typeof surface !== "boolean" || typeof store !== "boolean") {
      throw new SettingsValidationError(`each ${what} override needs boolean surface and store`);
    }
  }
}

function validateFieldOverrides(value: unknown): void {
  if (typeof value !== "object" || value == null) throw new SettingsValidationError("fieldOverrides must be an object");
  const o = value as Record<string, unknown>;
  if ("fields" in o) validateSupportMap(o["fields"], "fields");
  if ("entities" in o) validateSupportMap(o["entities"], "entities");
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Validate an org-governance object: { required: string[], forbidden: string[] }. */
function validateGovernance(value: unknown, label: string): void {
  if (typeof value !== "object" || value == null) throw new SettingsValidationError(`${label} must be an object`);
  const o = value as Record<string, unknown>;
  for (const k of ["required", "forbidden"]) {
    if (k in o && !isStringArray(o[k])) throw new SettingsValidationError(`${label}.${k} must be an array of strings`);
  }
  // A feature can't be simultaneously mandated and banned — a contradictory config where forbid silently
  // wins and the "must use" mandate is dropped. Reject it at the write boundary.
  const required = (o["required"] as string[] | undefined) ?? [];
  const forbidden = new Set((o["forbidden"] as string[] | undefined) ?? []);
  const clash = required.find((id) => forbidden.has(id));
  if (clash) throw new SettingsValidationError(`${label}: feature "${clash}" can't be both required and forbidden`);
}

/** Validate a per-scope feature map: Record<id, { disabled?, required?, forbidden? }> (each string[]). */
function validateScopeFeatureMap(value: unknown, label: string): void {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new SettingsValidationError(`${label} must be an object keyed by id`);
  }
  for (const [scopeId, cfg] of Object.entries(value as Record<string, unknown>)) {
    if (typeof cfg !== "object" || cfg == null) throw new SettingsValidationError(`${label}["${scopeId}"] must be an object`);
    for (const k of ["disabled", "required", "forbidden"]) {
      const arr = (cfg as Record<string, unknown>)[k];
      if (k in (cfg as object) && !isStringArray(arr)) {
        throw new SettingsValidationError(`${label}["${scopeId}"].${k} must be an array of strings`);
      }
    }
    // A feature can't be both required and forbidden in the same scope — the same contradictory-config
    // guard validateGovernance enforces at the org level (forbid silently wins, dropping the mandate).
    // Mirror it here so the per-scope maps aren't a bypass on the bulk PATCH / config-restore path.
    const c = cfg as Record<string, unknown>;
    const forb = new Set(isStringArray(c["forbidden"]) ? (c["forbidden"] as string[]) : []);
    const clash = (isStringArray(c["required"]) ? (c["required"] as string[]) : []).find((id) => forb.has(id));
    if (clash) throw new SettingsValidationError(`${label}["${scopeId}"]: feature "${clash}" can't be both required and forbidden`);
  }
}

/** Shape-validate the governance-rule list (deeper predicate-field checks live at the PMO route). */
function validateGovernanceRules(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new SettingsValidationError(`${label} must be an array`);
  for (const r of value) {
    const o = r as Record<string, unknown>;
    if (typeof o !== "object" || o == null || typeof o["id"] !== "string" || !o["id"]) {
      throw new SettingsValidationError(`${label} entries need a string id`);
    }
    for (const k of ["require", "forbid", "disable"]) if (k in o && !isStringArray(o[k])) {
      throw new SettingsValidationError(`${label} "${String(o["id"])}".${k} must be an array of strings`);
    }
    // Validate the optional `when` predicate too — an unvalidated malformed condition set (e.g.
    // `all` as an object) is persisted here and then throws in predicate.matches(), 500-ing every
    // feature-gated read for all users. (matches() is also hardened, but reject bad input on write.)
    if ("when" in o && o["when"] != null) {
      const when = o["when"];
      if (typeof when !== "object" || Array.isArray(when)) {
        throw new SettingsValidationError(`${label} "${String(o["id"])}".when must be an object`);
      }
      for (const key of ["all", "any"] as const) {
        if (key in (when as Record<string, unknown>)) {
          const arr = (when as Record<string, unknown>)[key];
          if (!Array.isArray(arr)) throw new SettingsValidationError(`${label} "${String(o["id"])}".when.${key} must be an array`);
          for (const p of arr) {
            const err = validatePredicate(p);
            if (err) throw new SettingsValidationError(`${label} "${String(o["id"])}".when.${key}: ${err}`);
          }
        }
      }
    }
  }
}

const CUSTOM_REPORT_AGGS = new Set(["sum", "avg", "count", "min", "max"]);

/** Shape-validate the bespoke report list: id/label/scope/viz + metric shape (field + known agg). */
const STYLE_FONTS = new Set(["sans", "serif", "mono"]);
const STYLE_ALIGNS = new Set(["left", "center"]);

/**
 * Shape-validate an optional ArtifactStyle. Saved views and custom reports are shared, customer-level
 * config, so a rogue value must not smuggle in an oversized payload or an unknown font. Colours are plain
 * CSS strings (the browser ignores an invalid one) but are length-capped; the font/align choices are the
 * fixed enums the SPA renders.
 */
function validateArtifactStyle(value: unknown, context: string): void {
  if (value == null) return;
  if (typeof value !== "object") throw new SettingsValidationError(`${context} style must be an object`);
  const s = value as Record<string, unknown>;
  for (const k of ["title", "subtitle"]) {
    const v = s[k];
    if (v != null && (typeof v !== "string" || v.length > 200)) throw new SettingsValidationError(`${context} style.${k} must be a string ≤200 chars`);
  }
  for (const k of ["textColor", "background"]) {
    const v = s[k];
    if (v != null && (typeof v !== "string" || v.length > 64)) throw new SettingsValidationError(`${context} style.${k} must be a CSS colour string ≤64 chars`);
  }
  if (s["fontFamily"] != null && !STYLE_FONTS.has(s["fontFamily"] as string)) throw new SettingsValidationError(`${context} style.fontFamily must be sans | serif | mono`);
  if (s["align"] != null && !STYLE_ALIGNS.has(s["align"] as string)) throw new SettingsValidationError(`${context} style.align must be left | center`);
}

function validateCustomReports(value: unknown): void {
  if (!Array.isArray(value)) throw new SettingsValidationError("customReports must be an array");
  for (const r of value) {
    const o = r as Record<string, unknown>;
    if (!o || typeof o !== "object" || typeof o["id"] !== "string" || !o["id"]) throw new SettingsValidationError("each custom report needs a string id");
    if (typeof o["label"] !== "string" || !o["label"]) throw new SettingsValidationError(`custom report "${String(o["id"])}" needs a label`);
    if (o["scope"] !== "project" && o["scope"] !== "portfolio" && o["scope"] !== "tasks") throw new SettingsValidationError(`custom report "${String(o["id"])}" scope must be project | portfolio | tasks`);
    if (!["table", "bar", "line", "area", "pie"].includes(o["viz"] as string)) throw new SettingsValidationError(`custom report "${String(o["id"])}" viz must be table | bar | line | area | pie`);
    if (o["chart"] != null) {
      if (typeof o["chart"] !== "object") throw new SettingsValidationError(`custom report "${String(o["id"])}" chart must be an object`);
      const c = o["chart"] as Record<string, unknown>;
      if (c["stacked"] != null && typeof c["stacked"] !== "boolean") throw new SettingsValidationError(`custom report "${String(o["id"])}" chart.stacked must be a boolean`);
      if (c["legend"] != null && typeof c["legend"] !== "boolean") throw new SettingsValidationError(`custom report "${String(o["id"])}" chart.legend must be a boolean`);
    }
    if (o["groupBy"] != null && typeof o["groupBy"] !== "string") throw new SettingsValidationError(`custom report "${String(o["id"])}" groupBy must be a string`);
    if (o["groupBy2"] != null && typeof o["groupBy2"] !== "string") throw new SettingsValidationError(`custom report "${String(o["id"])}" groupBy2 must be a string`);
    if (o["dateField"] != null && typeof o["dateField"] !== "string") throw new SettingsValidationError(`custom report "${String(o["id"])}" dateField must be a string`);
    if (!Array.isArray(o["metrics"]) || o["metrics"].length === 0) throw new SettingsValidationError(`custom report "${String(o["id"])}" needs at least one metric`);
    for (const m of o["metrics"] as unknown[]) {
      const mm = m as Record<string, unknown>;
      if (typeof mm?.["id"] !== "string" || !mm["id"]) throw new SettingsValidationError(`custom report "${String(o["id"])}" metric needs a string id`);
      if (typeof mm["field"] !== "string" || !mm["field"]) throw new SettingsValidationError(`custom report "${String(o["id"])}" metric needs a field`);
      if (typeof mm["agg"] !== "string" || !CUSTOM_REPORT_AGGS.has(mm["agg"])) throw new SettingsValidationError(`custom report "${String(o["id"])}" metric agg must be one of ${[...CUSTOM_REPORT_AGGS].join(", ")}`);
    }
    validateArtifactStyle(o["style"], `custom report "${String(o["id"])}"`);
  }
}

const PRIORITY_WEIGHT_KEYS = ["rice", "wsjf", "moscow", "strategic", "benefit"] as const;

/** Shape-validate the prioritisation weights: all five dimensions present, each a finite non-negative
 *  number. Weights need not sum to 100 (the scorer renormalises over the dimensions a project reports). */
function validatePriorityWeights(value: unknown): void {
  if (typeof value !== "object" || value == null) throw new SettingsValidationError("priorityWeights must be an object");
  const o = value as Record<string, unknown>;
  for (const k of PRIORITY_WEIGHT_KEYS) {
    const v = o[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new SettingsValidationError(`priorityWeights.${k} must be a non-negative number`);
    }
  }
}

const USAGE_PERIODS = ["hour", "day", "month"] as const;
const USAGE_METRICS = ["calls", "tokens"] as const;
const USAGE_COST_PER = ["call", "token", "ktoken"] as const;

/** Shape-validate the per-vendor usage policies: `{ [vendor]: { limit?, cost? } }`. A limit needs a
 *  known period+metric and a positive max; a cost needs a known unit, a non-negative amount and a
 *  currency. Unknown keys are ignored so the shape can't be used to smuggle arbitrary config. */
function validateUsagePolicies(value: unknown): void {
  if (typeof value !== "object" || value == null || Array.isArray(value)) throw new SettingsValidationError("usagePolicies must be an object");
  for (const [vendor, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenKey(vendor)) throw new SettingsValidationError("usagePolicies vendor key is not allowed");
    if (typeof raw !== "object" || raw == null) throw new SettingsValidationError(`usagePolicies.${vendor} must be an object`);
    const p = raw as Record<string, unknown>;
    if (p["limit"] !== undefined && p["limit"] !== null) {
      const l = p["limit"] as Record<string, unknown>;
      if (!(USAGE_PERIODS as readonly unknown[]).includes(l["period"])) throw new SettingsValidationError(`usagePolicies.${vendor}.limit.period must be one of: ${USAGE_PERIODS.join(", ")}`);
      if (!(USAGE_METRICS as readonly unknown[]).includes(l["metric"])) throw new SettingsValidationError(`usagePolicies.${vendor}.limit.metric must be one of: ${USAGE_METRICS.join(", ")}`);
      if (typeof l["max"] !== "number" || !Number.isFinite(l["max"]) || (l["max"] as number) <= 0) throw new SettingsValidationError(`usagePolicies.${vendor}.limit.max must be a positive number`);
    }
    if (p["cost"] !== undefined && p["cost"] !== null) {
      const c = p["cost"] as Record<string, unknown>;
      if (!(USAGE_COST_PER as readonly unknown[]).includes(c["per"])) throw new SettingsValidationError(`usagePolicies.${vendor}.cost.per must be one of: ${USAGE_COST_PER.join(", ")}`);
      if (typeof c["amount"] !== "number" || !Number.isFinite(c["amount"]) || (c["amount"] as number) < 0) throw new SettingsValidationError(`usagePolicies.${vendor}.cost.amount must be a non-negative number`);
      if (typeof c["currency"] !== "string" || !c["currency"].trim()) throw new SettingsValidationError(`usagePolicies.${vendor}.cost.currency must be a non-empty string`);
    }
  }
}

/** Shape-validate the built-in report overrides: id required; label/order/hidden optional + typed. */
function validateReportOverrides(value: unknown): void {
  if (!Array.isArray(value)) throw new SettingsValidationError("reportOverrides must be an array");
  for (const r of value) {
    const o = r as Record<string, unknown>;
    if (!o || typeof o !== "object" || typeof o["id"] !== "string" || !o["id"]) throw new SettingsValidationError("each report override needs a string id");
    if (o["label"] != null && typeof o["label"] !== "string") throw new SettingsValidationError(`report override "${String(o["id"])}" label must be a string`);
    if (o["order"] != null && typeof o["order"] !== "number") throw new SettingsValidationError(`report override "${String(o["id"])}" order must be a number`);
    if (o["hidden"] != null && typeof o["hidden"] !== "boolean") throw new SettingsValidationError(`report override "${String(o["id"])}" hidden must be a boolean`);
  }
}

/** Shape-validate the per-deployment report definitions. Each needs a string id + label, a known `kind`, a
 *  numeric `order`, and a `renderer` with an engine — enough to bind a definition to a registered renderer.
 *  Forward-compatible (extra fields kept, renderer-component existence NOT enforced here — same stance as
 *  reportOverrides/contentPages, so a renderer renamed in a later release doesn't brick a saved definition). */
const REPORT_KINDS = new Set(["schedule", "progress", "financial", "resource", "quality", "portfolio"]);
function validateReports(value: unknown): void {
  if (!Array.isArray(value)) throw new SettingsValidationError("reports must be an array");
  const ids = new Set<string>();
  for (const r of value) {
    const o = r as Record<string, unknown>;
    if (!o || typeof o !== "object" || typeof o["id"] !== "string" || !o["id"]) throw new SettingsValidationError("each report needs a string id");
    const id = o["id"] as string;
    if (ids.has(id)) throw new SettingsValidationError(`duplicate report id "${id}"`);
    ids.add(id);
    if (typeof o["label"] !== "string" || !o["label"]) throw new SettingsValidationError(`report "${id}" needs a label`);
    if (typeof o["kind"] !== "string" || !REPORT_KINDS.has(o["kind"])) throw new SettingsValidationError(`report "${id}" has an unknown kind`);
    if (typeof o["order"] !== "number") throw new SettingsValidationError(`report "${id}" order must be a number`);
    const rend = o["renderer"];
    if (!rend || typeof rend !== "object" || typeof (rend as Record<string, unknown>)["engine"] !== "string") {
      throw new SettingsValidationError(`report "${id}" needs a renderer with an engine`);
    }
  }
}

/** Shape-validate the content-page list: id/name required; componentIds an array of strings (existence
 *  against the live catalogue is NOT enforced here — same forward-compat stance as reportOverrides, so a
 *  component removed/renamed in a later release doesn't brick a previously-saved page). */
function validateContentPages(value: unknown): void {
  if (!Array.isArray(value)) throw new SettingsValidationError("contentPages must be an array");
  for (const p of value) {
    const o = p as Record<string, unknown>;
    if (!o || typeof o !== "object" || typeof o["id"] !== "string" || !o["id"]) throw new SettingsValidationError("each content page needs a string id");
    if (typeof o["name"] !== "string" || !o["name"]) throw new SettingsValidationError(`content page "${String(o["id"])}" needs a name`);
    if (!isStringArray(o["componentIds"])) throw new SettingsValidationError(`content page "${String(o["id"])}" componentIds must be an array of strings`);
  }
}

/** Shape-validate the outbound webhook list: an array whose every entry is an object with a
 *  string, safe-outbound `url`. */
function validateWebhooks(value: unknown): void {
  if (!Array.isArray(value)) throw new SettingsValidationError("webhooks must be an array");
  for (const w of value) {
    if (!w || typeof w !== "object") throw new SettingsValidationError("each webhook must be an object");
    const url = (w as Record<string, unknown>)["url"];
    if (typeof url !== "string") throw new SettingsValidationError("each webhook needs a url string");
    try {
      assertSafeOutboundUrl(url, "webhook url");
    } catch (err) {
      throw new SettingsValidationError(err instanceof UnsafeUrlError ? err.message : "webhook url is invalid");
    }
  }
}

/** Shape-validate the federated-peer list: id/label required, a safe-outbound `baseUrl`, a token
 *  string, and optional typed region/active. */
function validateFederatedPeers(value: unknown): void {
  if (!Array.isArray(value)) throw new SettingsValidationError("federatedPeers must be an array");
  for (const p of value) {
    if (!p || typeof p !== "object") throw new SettingsValidationError("each federated peer must be an object");
    const o = p as Record<string, unknown>;
    if (typeof o["id"] !== "string" || !o["id"]) throw new SettingsValidationError("each federated peer needs a string id");
    if (typeof o["label"] !== "string" || !o["label"]) throw new SettingsValidationError(`federated peer "${String(o["id"])}" needs a label`);
    const baseUrl = o["baseUrl"];
    if (typeof baseUrl !== "string" || !baseUrl) throw new SettingsValidationError(`federated peer "${String(o["id"])}" needs a baseUrl`);
    try {
      assertSafeOutboundUrl(baseUrl, "federated peer baseUrl");
    } catch (err) {
      throw new SettingsValidationError(err instanceof UnsafeUrlError ? err.message : "federated peer baseUrl is invalid");
    }
    if (typeof o["token"] !== "string") throw new SettingsValidationError(`federated peer "${String(o["id"])}" needs a token string`);
    if (o["region"] != null && typeof o["region"] !== "string") throw new SettingsValidationError(`federated peer "${String(o["id"])}" region must be a string or null`);
    if ("active" in o && typeof o["active"] !== "boolean") throw new SettingsValidationError(`federated peer "${String(o["id"])}" active must be a boolean`);
  }
}

/** Shape-validate the saved-view list: an array whose every entry is an object with a string id + name. */
export function validateSavedViews(value: unknown): void {
  if (!Array.isArray(value)) throw new SettingsValidationError("savedViews must be an array");
  for (const view of value) {
    if (!view || typeof view !== "object") throw new SettingsValidationError("each saved view must be an object");
    const { id, name, entity, viewKind, sort, filters, groupBy, columns } = view as Record<string, unknown>;
    if (typeof id !== "string" || !id) throw new SettingsValidationError("each saved view needs a string id");
    if (typeof name !== "string" || !name) throw new SettingsValidationError("each saved view needs a name");
    // Optional view-engine fields — harden them since saved views are shared, customer-level config.
    if (entity != null && entity !== "task" && entity !== "issue") throw new SettingsValidationError("saved view entity must be 'task' or 'issue'");
    if (viewKind != null && !["list", "board", "table", "timeline", "chart"].includes(viewKind as string)) throw new SettingsValidationError("saved view viewKind must be 'list', 'board', 'table', 'timeline' or 'chart'");
    const chart = (view as Record<string, unknown>)["chart"];
    if (chart != null) {
      if (typeof chart !== "object") throw new SettingsValidationError("saved view chart must be an object");
      const ct = (chart as Record<string, unknown>)["type"];
      if (!["bar", "pie", "donut", "wbs", "gantt"].includes(ct as string)) throw new SettingsValidationError("saved view chart.type must be bar | pie | donut | wbs | gantt");
      for (const k of ["groupField", "startField", "endField"]) {
        const v = (chart as Record<string, unknown>)[k];
        if (v != null && typeof v !== "string") throw new SettingsValidationError(`saved view chart.${k} must be a string`);
      }
    }
    if (groupBy != null && typeof groupBy !== "string") throw new SettingsValidationError("saved view groupBy must be a string");
    if ((view as Record<string, unknown>)["dateField"] != null && typeof (view as Record<string, unknown>)["dateField"] !== "string") throw new SettingsValidationError("saved view dateField must be a string");
    if (columns != null && (!Array.isArray(columns) || columns.some((c) => typeof c !== "string"))) throw new SettingsValidationError("saved view columns must be an array of strings");
    if (sort != null) {
      if (typeof sort !== "object") throw new SettingsValidationError("saved view sort must be an object");
      const { field, dir } = sort as Record<string, unknown>;
      if (typeof field !== "string" || !field) throw new SettingsValidationError("saved view sort.field must be a string");
      if (dir !== "asc" && dir !== "desc") throw new SettingsValidationError("saved view sort.dir must be 'asc' or 'desc'");
    }
    if (filters != null) {
      if (!Array.isArray(filters)) throw new SettingsValidationError("saved view filters must be an array");
      for (const f of filters) {
        if (!f || typeof f !== "object") throw new SettingsValidationError("each saved view filter must be an object");
        const { field, value: fv } = f as Record<string, unknown>;
        if (typeof field !== "string" || !field) throw new SettingsValidationError("each saved view filter needs a string field");
        if (typeof fv !== "string") throw new SettingsValidationError("each saved view filter needs a string value");
      }
    }
    validateArtifactStyle((view as Record<string, unknown>)["style"], `saved view "${String(id)}"`);
  }
}

/**
 * Shape-validate saved PANEL VIEWS. Each needs a string id/label and a scoping screen+panel id, plus a
 * `state` object whose `groupBy`/`agg` are strings and whose `filters` map field → an array of string
 * values. Hardened because these are shared, customer-level config that ride the config bundle; a malformed
 * or hostile entry must 400, never persist a shape a renderer could choke on.
 */
export function validatePanelViews(value: unknown): void {
  if (!Array.isArray(value)) throw new SettingsValidationError("panelViews must be an array");
  const ids = new Set<string>();
  for (const view of value) {
    if (!view || typeof view !== "object") throw new SettingsValidationError("each panel view must be an object");
    const { id, label, screen, panel, state } = view as Record<string, unknown>;
    if (typeof id !== "string" || !id) throw new SettingsValidationError("each panel view needs a string id");
    if (ids.has(id)) throw new SettingsValidationError(`duplicate panel view id "${id}"`);
    ids.add(id);
    if (typeof label !== "string" || !label) throw new SettingsValidationError("each panel view needs a label");
    if (typeof screen !== "string" || !screen) throw new SettingsValidationError("each panel view needs a screen id");
    if (typeof panel !== "string" || !panel) throw new SettingsValidationError("each panel view needs a panel id");
    if (!state || typeof state !== "object") throw new SettingsValidationError("each panel view needs a state object");
    const { groupBy, agg, filters } = state as Record<string, unknown>;
    if (typeof groupBy !== "string") throw new SettingsValidationError("panel view state.groupBy must be a string");
    if (typeof agg !== "string") throw new SettingsValidationError("panel view state.agg must be a string");
    if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new SettingsValidationError("panel view state.filters must be an object");
    for (const [field, vals] of Object.entries(filters as Record<string, unknown>)) {
      if (isForbiddenKey(field)) throw new SettingsValidationError("panel view filter field is not allowed");
      if (!Array.isArray(vals) || vals.some((v) => typeof v !== "string")) throw new SettingsValidationError(`panel view filter "${field}" must be an array of strings`);
    }
  }
}

/** Shape-validate the dashboard list: id/name required, optional non-negative refreshMs, and a
 *  widgets array whose entries each carry a string id + type. */
function validateDashboards(value: unknown): void {
  if (!Array.isArray(value)) throw new SettingsValidationError("dashboards must be an array");
  for (const dash of value) {
    if (!dash || typeof dash !== "object") throw new SettingsValidationError("each dashboard must be an object");
    const { id, name, widgets } = dash as Record<string, unknown>;
    if (typeof id !== "string" || !id) throw new SettingsValidationError("each dashboard needs a string id");
    if (typeof name !== "string" || !name) throw new SettingsValidationError("each dashboard needs a name");
    const { refreshMs } = dash as Record<string, unknown>;
    if (refreshMs != null && (typeof refreshMs !== "number" || refreshMs < 0)) throw new SettingsValidationError("each dashboard refreshMs must be a non-negative number");
    if (!Array.isArray(widgets)) throw new SettingsValidationError("each dashboard needs a widgets array");
    for (const w of widgets) {
      if (!w || typeof w !== "object") throw new SettingsValidationError("each dashboard widget must be an object");
      const { id: wid, type } = w as Record<string, unknown>;
      if (typeof wid !== "string" || !wid) throw new SettingsValidationError("each dashboard widget needs a string id");
      if (typeof type !== "string" || !type) throw new SettingsValidationError("each dashboard widget needs a type");
    }
  }
}

/** Validate the opt-in logging-sync egress config: an object with an optional safe-outbound `url`;
 *  turning it on requires both a url and an explicit warranty acknowledgement. */
function validateLoggingSync(value: unknown): void {
  if (!value || typeof value !== "object") throw new SettingsValidationError("loggingSync must be an object");
  const { enabled, url, acknowledgedWarranty } = value as Record<string, unknown>;
  if (url != null) {
    if (typeof url !== "string") throw new SettingsValidationError("loggingSync.url must be a string or null");
    try {
      assertSafeOutboundUrl(url, "loggingSync.url");
    } catch (err) {
      throw new SettingsValidationError(err instanceof UnsafeUrlError ? err.message : "loggingSync.url is invalid");
    }
  }
  if (enabled === true) {
    // Egress is the one out-of-warranty relaxation: it can only be turned on
    // with a destination AND an explicit acknowledgement of the warranty boundary.
    if (typeof url !== "string" || !url) throw new SettingsValidationError("enable the logging sync requires a url");
    if (acknowledgedWarranty !== true) {
      throw new SettingsValidationError("enabling the logging sync requires acknowledging that egressed data is outside OmniProject's warranty");
    }
  }
}

/** Validate the opt-in self-host adoption config: a valid mode, a string[] of adopted domain ids,
 *  and — the "disclose, don't insure" gate — an explicit acknowledgement whenever the mode isn't
 *  `off`. A non-off mode without the acknowledgement is rejected, mirroring `validateLoggingSync`. */
function validateSelfHost(value: unknown): void {
  if (!value || typeof value !== "object") throw new SettingsValidationError("selfHost must be an object");
  const { mode, adopted, acknowledgedDataResponsibility } = value as Record<string, unknown>;
  if (!(SELF_HOST_MODES as readonly string[]).includes(mode as string)) {
    throw new SettingsValidationError(`selfHost.mode must be one of: ${SELF_HOST_MODES.join(", ")}`);
  }
  if (!Array.isArray(adopted) || adopted.some((x) => typeof x !== "string")) {
    throw new SettingsValidationError("selfHost.adopted must be an array of strings");
  }
  if (typeof acknowledgedDataResponsibility !== "boolean") {
    throw new SettingsValidationError("selfHost.acknowledgedDataResponsibility must be a boolean");
  }
  if (mode !== "off" && acknowledgedDataResponsibility !== true) {
    throw new SettingsValidationError(
      "enabling self-host storage requires acknowledging that the data is yours to own, secure and back up (outside OmniProject's warranty)",
    );
  }
}

/** Validate the digest email-delivery config: `emailRecipients` must be a bounded array of non-empty
 *  strings that look like email addresses (a light `x@y` shape check — the SMTP layer is the real
 *  arbiter). Empty is valid (delivery off). */
function validateDigestDelivery(value: unknown): void {
  if (!value || typeof value !== "object") throw new SettingsValidationError("digestDelivery must be an object");
  const { emailRecipients } = value as Record<string, unknown>;
  if (!Array.isArray(emailRecipients) || emailRecipients.some((x) => typeof x !== "string")) {
    throw new SettingsValidationError("digestDelivery.emailRecipients must be an array of strings");
  }
  if (emailRecipients.length > MAX_DIGEST_RECIPIENTS) {
    throw new SettingsValidationError(`digestDelivery.emailRecipients must have at most ${MAX_DIGEST_RECIPIENTS} entries`);
  }
  for (const r of emailRecipients as string[]) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.trim())) {
      throw new SettingsValidationError(`digestDelivery.emailRecipients contains an invalid email address: ${r}`);
    }
  }
}

/** Validate the history-retention config: a valid org-default cadence plus per-scope override maps of
 *  valid cadences. Retention is infinite by policy, so there's no window to validate — only cadence. */
function validateHistoryRetention(value: unknown): void {
  if (!value || typeof value !== "object") throw new SettingsValidationError("historyRetention must be an object");
  const { orgDefault, programme, project } = value as Record<string, unknown>;
  if (!isValidCadence(orgDefault)) {
    throw new SettingsValidationError("historyRetention.orgDefault must be a valid cadence (onWrite | manual | interval{everyHours})");
  }
  for (const [name, map] of [["programme", programme], ["project", project]] as const) {
    if (map === undefined) continue;
    if (!map || typeof map !== "object") throw new SettingsValidationError(`historyRetention.${name} must be an object`);
    for (const [key, cadence] of Object.entries(map as Record<string, unknown>)) {
      if (!isValidCadence(cadence)) throw new SettingsValidationError(`historyRetention.${name}.${key} must be a valid cadence`);
    }
  }
  const { retentionDays, legalHolds } = value as Record<string, unknown>;
  if (retentionDays !== undefined && retentionDays !== null) {
    if (typeof retentionDays !== "number" || !Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new SettingsValidationError("historyRetention.retentionDays must be a positive integer (or null for infinite retention)");
    }
  }
  if (legalHolds !== undefined) {
    if (!Array.isArray(legalHolds) || legalHolds.some((k) => typeof k !== "string")) {
      throw new SettingsValidationError("historyRetention.legalHolds must be an array of \"entity#id\" strings");
    }
  }
}

/** Validate the skills-planning config: a matrix of resources (skills 1–5, non-negative capacity) and
 *  a list of demand requests (positive hours, optional proficiency bar). Config, so kept light. */
function validateSkillsPlanning(value: unknown): void {
  if (!value || typeof value !== "object") throw new SettingsValidationError("skillsPlanning must be an object");
  const { matrix, demand } = value as Record<string, unknown>;
  if (matrix !== undefined) {
    if (!Array.isArray(matrix)) throw new SettingsValidationError("skillsPlanning.matrix must be an array");
    for (const r of matrix) {
      const res = r as Record<string, unknown>;
      if (typeof res?.["resourceId"] !== "string" || typeof res?.["name"] !== "string") throw new SettingsValidationError("each skills matrix row needs resourceId + name");
      if (typeof res["capacityHours"] !== "number" || !Number.isFinite(res["capacityHours"]) || res["capacityHours"] < 0) throw new SettingsValidationError("skills matrix capacityHours must be a non-negative number");
      const skills = res["skills"];
      if (!skills || typeof skills !== "object") throw new SettingsValidationError("skills matrix row needs a skills object");
      for (const [, prof] of Object.entries(skills as Record<string, unknown>)) {
        if (typeof prof !== "number" || prof < 1 || prof > 5) throw new SettingsValidationError("skill proficiency must be 1–5");
      }
    }
  }
  if (demand !== undefined) {
    if (!Array.isArray(demand)) throw new SettingsValidationError("skillsPlanning.demand must be an array");
    for (const d of demand) {
      const req = d as Record<string, unknown>;
      if (typeof req?.["id"] !== "string" || typeof req?.["skill"] !== "string") throw new SettingsValidationError("each demand row needs id + skill");
      if (typeof req["hoursNeeded"] !== "number" || !Number.isFinite(req["hoursNeeded"]) || req["hoursNeeded"] < 0) throw new SettingsValidationError("demand hoursNeeded must be a non-negative number");
      if (req["minProficiency"] !== undefined && (typeof req["minProficiency"] !== "number" || req["minProficiency"] < 1 || req["minProficiency"] > 5)) throw new SettingsValidationError("demand minProficiency must be 1–5");
    }
  }
}

/** Per-capability sanitizer for the `capabilityStates` map, INJECTED by lib/capability-governance at
 *  its module init. It lives there (not here) because that module owns the capability catalogue and
 *  the clamps — and importing it eagerly from settings.ts would form an init-time cycle (it reads
 *  AI_PROVIDERS from here at load). Until it registers, the bulk-PATCH path keeps only the top-level
 *  shape-check as its floor; the running app always registers it before serving a request. */
type CapabilityStatesSanitizer = (states: Record<string, unknown>) => Record<string, unknown>;
let capabilityStatesSanitizer: CapabilityStatesSanitizer | null = null;
export function registerCapabilityStatesSanitizer(fn: CapabilityStatesSanitizer): void {
  capabilityStatesSanitizer = fn;
}

/** Validate a settings patch and return a NORMALIZED copy (reportingCurrency upper-cased,
 *  fxRateAsOfDate/reportingCurrency empty-string coerced to null, …) — pure, never mutates the
 *  caller's `patch` object. Throws SettingsValidationError on bad input. */
export function validatePatch(rawPatch: Record<string, unknown>): Record<string, unknown> {
  // Strip prototype-pollution-dangerous OWN keys (__proto__/constructor/prototype) at every depth BEFORE
  // any field is read or persisted. Over HTTP the express.json reviver already does this, but a config-
  // snapshot restore / internal updateSettings() call parses with bare JSON.parse — so a field whose
  // validator only shape-checks and passes the object through verbatim (loggingSync, selfHost, …) would
  // otherwise persist a dangerous key. Doing it here closes the class for EVERY field, present and future,
  // at the single write gate. Pure — the caller's object is never mutated.
  const patch = stripDangerousKeysDeep(rawPatch);
  const normalized: Record<string, unknown> = { ...patch };
  // Per-field validation is dispatched from FIELD_DESCRIPTORS — one validator per field that throws
  // SettingsValidationError on bad input and returns the value to persist (possibly normalised). Iterated
  // in ALLOWED_KEYS (registry) order so the outcome is deterministic; keys not in the registry (unknown
  // fields) are left untouched in `normalized` — updateSettings only ever writes ALLOWED_KEYS.
  for (const [key, descriptor] of Object.entries(FIELD_DESCRIPTORS)) {
    if (key in patch) normalized[key] = descriptor.validate(patch[key]);
  }
  // ── Cross-field rules — a per-field descriptor can't see its siblings, so these run after the loop ──
  // Whenever custom fields OR the routing map changes, every custom field must still be mapped to a source
  // in the matrix (route it to the Postgres backend if there's no external one). Checked over the EFFECTIVE
  // (patch-merged) values so you can't drop a route out from under a field that depended on it.
  if ("customFields" in patch || "fieldRouting" in patch) {
    const effCustom = ("customFields" in normalized ? normalized["customFields"] : store.customFields) as CustomField[];
    const effRouting = ("fieldRouting" in normalized ? normalized["fieldRouting"] : store.fieldRouting) as FieldRoute[];
    try {
      validateCustomFieldSources(effCustom, effRouting);
    } catch (e) {
      if (e instanceof CustomFieldError) throw new SettingsValidationError(e.message);
      throw e;
    }
  }
  // Retirement is STICKY: CLOSING a project (a closedProjects entry) retires its GUID, exactly like
  // deleting it — so moving it back live requires a re-link to a NEW GUID, never a silent reactivation.
  // Union the effective closed GUIDs into retiredGuids on any write that touches either.
  if ("closedProjects" in normalized || "retiredGuids" in normalized) {
    const effClosed = ("closedProjects" in normalized ? normalized["closedProjects"] : store.closedProjects) as ClosedProjectRegistry;
    const effRetired = ("retiredGuids" in normalized ? normalized["retiredGuids"] : store.retiredGuids) as string[];
    normalized["retiredGuids"] = [...new Set([...effRetired, ...Object.keys(effClosed)])];
  }
  // ── Cross-field INCOMPATIBILITY registry (lib/settings-constraints) — reject illegal COMBINATIONS a
  // single-field validator can't see (e.g. a feature both org-enabled AND org-disabled). Evaluated over
  // the effective (patch-merged) settings, same basis as the rules above. The registry's `locks` (inert
  // fields the admin UI greys out) are advisory and surfaced via the settings read, not enforced here.
  const { violations } = evaluateConstraints({ ...store, ...normalized } as unknown as SettingsState);
  if (violations.length > 0) throw new SettingsValidationError(violations[0]!.message);
  return normalized;
}

/** Validate a screen-layout map: order/hidden = string[], spans = integer 1–12 per panel. Drops any
 *  malformed layout / span so a bulk PATCH or config restore can't persist a structurally-invalid one. */
function validateScreenLayouts(value: Record<string, unknown>): Record<string, ScreenLayout> {
  const out: Record<string, ScreenLayout> = {};
  for (const [id, layout] of Object.entries(value)) {
    if (isForbiddenKey(id) || !layout || typeof layout !== "object" || Array.isArray(layout)) continue;
    const l = layout as Record<string, unknown>;
    const spans: Record<string, number> = {};
    if (l["spans"] && typeof l["spans"] === "object" && !Array.isArray(l["spans"])) {
      for (const [k, n] of Object.entries(l["spans"] as Record<string, unknown>)) {
        if (!isForbiddenKey(k) && typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 12) spans[k] = n;
      }
    }
    out[id] = {
      order: isStringArray(l["order"]) ? (l["order"] as string[]) : [],
      hidden: isStringArray(l["hidden"]) ? (l["hidden"] as string[]) : [],
      spans,
    };
  }
  return out;
}

/** Validate + apply a partial settings patch, returning the new settings. Throws
 *  SettingsValidationError on bad input (rejected atomically — nothing persists). */
export function updateSettings(patch: Record<string, unknown>): SettingsState {
  const normalized = validatePatch(patch);
  const writable = store as unknown as Record<string, unknown>;
  for (const key of ALLOWED_KEYS) {
    if (key in normalized) {
      writable[key] = normalized[key];
    }
  }
  // A profile change takes effect for the runtime accessors (TLS posture, reporting, …).
  if ("deploymentProfile" in normalized) setRuntimeProfile(store.deploymentProfile ?? null);
  refreshSettingsSnapshot(); // the store changed — rebuild the frozen read snapshot getSettings() serves
  return { ...store };
}

// Apply the initial (env-seeded) profile to the runtime accessor at module load.
setRuntimeProfile(store.deploymentProfile ?? null);

/**
 * Boot-time archetype seeding: if `SETTINGS_PRESET` names a known-good blueprint (lib/settings-presets),
 * apply it over the env-seeded defaults at startup, so a docker-compose can DECLARE its customer
 * archetype (`SETTINGS_PRESET=regulated-selfhost`) and the app self-configures to match — the compose
 * and the wizard preset stay in lock-step. Applied once; the operator can still tweak everything after.
 * Idempotent + best-effort (an unknown/invalid id is logged, never fatal). Exported for the boot test.
 */
export function applyBootSettingsPreset(id: string | undefined = process.env["SETTINGS_PRESET"]?.trim()): void {
  if (!id) return;
  const preset = settingsPreset(id);
  if (!preset) {
    logger.warn({ preset: id }, "SETTINGS_PRESET names no known blueprint — ignoring");
    return;
  }
  try {
    updateSettings(preset.settings);
    logger.info({ preset: id }, "applied settings blueprint from SETTINGS_PRESET");
  } catch (err) {
    logger.warn({ err, preset: id }, "SETTINGS_PRESET blueprint failed to apply — keeping defaults");
  }
}

applyBootSettingsPreset();
