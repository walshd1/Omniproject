/**
 * Gateway-local settings store.
 *
 * These configure the gateway itself (which n8n webhook to call, which AI
 * provider to use, etc.) and so are NOT brokered through n8n. In a multi-replica
 * deployment back this with a shared store (Redis/Postgres); the in-memory store
 * is sufficient for single-instance and demo use.
 */

import { assertSafeOutboundUrl, isSafeOutboundUrl, UnsafeUrlError } from "./url-safety";
import { DEPLOYMENT_PROFILES, setRuntimeProfile, type DeploymentProfile } from "./deployment-profile";
import type { BackendFieldMap } from "../broker/types";
import type { GovernanceRule } from "./governance-rules";
import { logger } from "./logger";

function coerceProfile(raw: unknown): DeploymentProfile | undefined {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (DEPLOYMENT_PROFILES as readonly string[]).includes(v) ? (v as DeploymentProfile) : undefined;
}

export const AI_PROVIDERS = ["none", "openai", "ollama", "anthropic", "openrouter"] as const;
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
// Free-form backend routing hint passed to n8n. "all" = no filter (whatever
// n8n is wired to). No specific backend (Plane/OpenProject/…) is required.
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

const DEFAULT_LOGGING_SYNC: LoggingSyncConfig = { enabled: false, url: null, acknowledgedWarranty: false };

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

export interface SettingsState {
  /** The active broker's webhook/endpoint URL (n8n by default). */
  brokerUrl: string | null;
  aiProvider: AiProvider;
  sttProvider: SttProvider;
  /** Deployment context chosen in the setup wizard (relaxes enterprise couplings by choice). */
  deploymentProfile?: DeploymentProfile;
  aiModel: string | null;
  backendSource: BackendSource;
  /** Default ISO 4217 reporting currency for consolidated financial reports (null ⇒ use the FX base). */
  reportingCurrency: string | null;
  /** Which FX rate a consolidated report converts at: today's spot rate, or a rate "as of"
   *  `fxRateAsOfDate` (period-close or the rate the budget was set at). See `FxRatePolicy`. */
  fxRatePolicy: FxRatePolicy;
  /** ISO 8601 date the "as of" rate is read for when `fxRatePolicy` isn't "spot". Ignored (falls
   *  back to spot) when null or when `fxRatePolicy` is "spot". */
  fxRateAsOfDate: string | null;
  oidcIssuerUrl: string | null;
  /** White-label branding overrides (null/empty → product defaults). */
  branding: BrandingConfig | null;
  /** Company-nomenclature label overrides, keyed by i18n key. */
  labelOverrides: Record<string, string>;
  /** Outbound webhook subscriptions. */
  webhooks: WebhookSubscription[];
  /**
   * Other OmniProject instances this deployment can fan out to for a federated portfolio view
   * (backlog #135). Config only — URLs + bearer credentials, never project data. See
   * routes/federated-peers + lib/federation.
   */
  federatedPeers: PeerInstance[];
  /** Opt-in state-history egress to an operator-owned logging server (off by default). */
  loggingSync: LoggingSyncConfig;
  /** Opt-in self-host DB adoption (off by default; needs a data-responsibility ack to enable). */
  selfHost: SelfHostConfig;
  /**
   * Admin translation-layer overrides: per-field / per-entity surface+store that
   * REPLACE the broker-derived/declared capability map. Lets an admin correct a
   * mis-mapped field (e.g. force a field the auto-derivation hid back on, or hide
   * one the backend exposes but shouldn't). Config, never project data.
   */
  fieldOverrides: BackendFieldMap;
  /**
   * Per-screen layout overrides (drag-arranged panel order / spans / hidden), keyed
   * by screen id. Presentation config — part of the snapshot/export so it travels in
   * the customer's config JSON. Never project data.
   */
  screenLayouts: Record<string, ScreenLayout>;
  /**
   * Per-user UI preferences (accessibility: text size, background colour, contrast,
   * motion), keyed by the user's `sub`. Stored as JSON with code defaults so a
   * person's setup PERSISTS ACROSS SESSIONS and devices — important for users with
   * dyslexia / visual impairment. Personal config, never project data.
   */
  userPrefs: Record<string, UserPrefs>;
  /**
   * Admin data-governance for the governed capabilities (AI tools, the MCP, AI
   * providers and vendors), keyed by capability id. Off by default; the admin sets
   * each to off / user-defined / public (and, for AI tools, per-surface). Customer-
   * level config — rides the snapshot/export — never project data.
   */
  capabilityStates: Record<string, CapabilitySetting>;
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
  /**
   * Admin/PMO view-curation: canonical field keys HIDDEN from view on top of what the backend makes
   * available. The availability resolver subtracts these from the surfaced set, so a deployment can
   * trim available-but-unwanted fields. Customer-level config — rides the snapshot/export so the
   * curated view travels in the bundle — never project data. See lib/availability.
   */
  hiddenFields: string[];
  /**
   * Named saved views (filters + sort + visible columns + grouping) a user can switch between.
   * Customer-level presentation config — rides the snapshot/export so saved views travel in the
   * bundle — never project data. See routes/views + the SPA savedViews feature module.
   */
  savedViews: SavedView[];
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
   * Named content pages: an ordered, flat list of unified-library component ids (reports + widgets,
   * see @workspace/backend-catalogue componentsFor("content")) a customer composes into free-form
   * content, rendered through the generic content-page renderer. Same shared-config shape as
   * customReports — customer-level presentation config, rides the snapshot/export, never project
   * data. See routes/content-pages + the SPA contentPages feature module.
   */
  contentPages: ContentPageDef[];
  /**
   * Portfolio prioritisation scoring weights (backlog #98): how much RICE / WSJF / MoSCoW /
   * strategic-goal contribution / benefits realisation each count toward a project's rank score.
   * ONLY the formula weights are config — the score itself is computed live over the read model on
   * every request, never persisted. Customer-level config; rides the snapshot/export. See
   * routes/portfolio-priority-weights + the SPA PortfolioPrioritisation report.
   */
  priorityWeights: PriorityWeights;
}

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
  /** Visible canonical field keys, in display order. */
  columns?: string[];
  sort?: { field: string; dir: "asc" | "desc" };
  filters?: { field: string; value: string }[];
  groupBy?: string;
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
  /** "project" renders per selected project; "portfolio" rolls up across all projects. */
  scope: "project" | "portfolio";
  groupBy?: string;
  /** Second group-by level (pivot columns) — ignored without `groupBy`, and for `viz: "line"`. */
  groupBy2?: string;
  metrics: CustomReportMetric[];
  filter?: { all?: unknown[]; any?: unknown[] };
  viz: "table" | "bar" | "line";
  /** Required for `viz: "line"`: a date field bucketed by month to build a time trend. */
  dateField?: string;
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
  backgroundColor: string | null;
  highContrast: boolean;
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

function brandingFromEnv(): BrandingConfig | null {
  const b: BrandingConfig = {
    appName: process.env["BRAND_APP_NAME"]?.trim() || null,
    shortName: process.env["BRAND_SHORT_NAME"]?.trim() || null,
    logoUrl: process.env["BRAND_LOGO_URL"]?.trim() || null,
    primaryColor: process.env["BRAND_PRIMARY_COLOR"]?.trim() || null,
    loginHeading: process.env["BRAND_LOGIN_HEADING"]?.trim() || null,
    footerText: process.env["BRAND_FOOTER_TEXT"]?.trim() || null,
    supportUrl: process.env["BRAND_SUPPORT_URL"]?.trim() || null,
    fontFamily: process.env["BRAND_FONT_FAMILY"]?.trim() || null,
  };
  return Object.values(b).some(Boolean) ? b : null;
}

function labelsFromEnv(): Record<string, string> {
  const raw = process.env["LABEL_OVERRIDES"]?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch (err) {
    logger.warn({ err }, "LABEL_OVERRIDES is not valid JSON — ignoring, no label overrides seeded");
    return {};
  }
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
const store: SettingsState = {
  brokerUrl: process.env["BROKER_URL"]?.trim() || null,
  aiProvider: coerceAiProvider(process.env["AI_PROVIDER"]?.trim() || "none"),
  sttProvider: coerceSttProvider(process.env["STT_PROVIDER"]?.trim() || "none"),
  // Omit (rather than set undefined) when no profile is configured — exactOptionalPropertyTypes.
  ...(initialProfile !== undefined ? { deploymentProfile: initialProfile } : {}),
  aiModel: process.env["AI_MODEL"] ?? null,
  backendSource: process.env["BACKEND_SOURCE"]?.trim() || "all",
  reportingCurrency: process.env["REPORTING_CURRENCY"]?.trim().toUpperCase() || null,
  fxRatePolicy: coerceFxRatePolicy(process.env["FX_RATE_POLICY"]?.trim()),
  fxRateAsOfDate: process.env["FX_RATE_AS_OF_DATE"]?.trim() || null,
  oidcIssuerUrl: process.env["OIDC_ISSUER_URL"] ?? null,
  branding: brandingFromEnv(),
  labelOverrides: labelsFromEnv(),
  webhooks: webhooksFromEnv(),
  federatedPeers: peersFromEnv(),
  loggingSync: loggingSyncFromEnv(),
  selfHost: { ...DEFAULT_SELF_HOST },
  fieldOverrides: { fields: {}, entities: {} },
  screenLayouts: {},
  userPrefs: {},
  capabilityStates: {},
  disabledFeatures: disabledFeaturesFromEnv(),
  enabledFeatures: enabledFeaturesFromEnv(),
  featureGovernance: { required: [], forbidden: [] },
  programmeFeatures: {},
  projectFeatures: {},
  governanceRules: [],
  hiddenFields: [],
  savedViews: [],
  customReports: [],
  reportOverrides: [],
  dashboards: [],
  contentPages: [],
  priorityWeights: { ...DEFAULT_PRIORITY_WEIGHTS },
};

/** True when historical time-travel is available (operator opted into egress). */
export function isTimeTravelEnabled(): boolean {
  return store.loggingSync.enabled;
}

const ALLOWED_KEYS: (keyof SettingsState)[] = [
  "brokerUrl",
  "aiProvider",
  "sttProvider",
  "deploymentProfile",
  "aiModel",
  "backendSource",
  "reportingCurrency",
  "fxRatePolicy",
  "fxRateAsOfDate",
  "oidcIssuerUrl",
  "branding",
  "labelOverrides",
  "webhooks",
  "federatedPeers",
  "loggingSync",
  "selfHost",
  "fieldOverrides",
  "screenLayouts",
  "userPrefs",
  "capabilityStates",
  "disabledFeatures",
  "enabledFeatures",
  "featureGovernance",
  "programmeFeatures",
  "projectFeatures",
  "governanceRules",
  "hiddenFields",
  "savedViews",
  "customReports",
  "reportOverrides",
  "dashboards",
  "contentPages",
  "priorityWeights",
];

/** A snapshot copy of the current in-memory settings (never the live reference). */
export function getSettings(): SettingsState {
  return { ...store };
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
  }
}

const CUSTOM_REPORT_AGGS = new Set(["sum", "avg", "count", "min", "max"]);

/** Shape-validate the bespoke report list: id/label/scope/viz + metric shape (field + known agg). */
function validateCustomReports(value: unknown): void {
  if (!Array.isArray(value)) throw new SettingsValidationError("customReports must be an array");
  for (const r of value) {
    const o = r as Record<string, unknown>;
    if (!o || typeof o !== "object" || typeof o["id"] !== "string" || !o["id"]) throw new SettingsValidationError("each custom report needs a string id");
    if (typeof o["label"] !== "string" || !o["label"]) throw new SettingsValidationError(`custom report "${String(o["id"])}" needs a label`);
    if (o["scope"] !== "project" && o["scope"] !== "portfolio") throw new SettingsValidationError(`custom report "${String(o["id"])}" scope must be project | portfolio`);
    if (o["viz"] !== "table" && o["viz"] !== "bar" && o["viz"] !== "line") throw new SettingsValidationError(`custom report "${String(o["id"])}" viz must be table | bar | line`);
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
function validateSavedViews(value: unknown): void {
  if (!Array.isArray(value)) throw new SettingsValidationError("savedViews must be an array");
  for (const view of value) {
    if (!view || typeof view !== "object") throw new SettingsValidationError("each saved view must be an object");
    const { id, name } = view as Record<string, unknown>;
    if (typeof id !== "string" || !id) throw new SettingsValidationError("each saved view needs a string id");
    if (typeof name !== "string" || !name) throw new SettingsValidationError("each saved view needs a name");
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

/** Validate a settings patch and return a NORMALIZED copy (reportingCurrency upper-cased,
 *  fxRateAsOfDate/reportingCurrency empty-string coerced to null, …) — pure, never mutates the
 *  caller's `patch` object. Throws SettingsValidationError on bad input. */
function validatePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...patch };
  if ("aiProvider" in patch && !(AI_PROVIDERS as readonly string[]).includes(patch["aiProvider"] as string)) {
    throw new SettingsValidationError(`aiProvider must be one of: ${AI_PROVIDERS.join(", ")}`);
  }
  if ("sttProvider" in patch && !(STT_PROVIDERS as readonly string[]).includes(patch["sttProvider"] as string)) {
    throw new SettingsValidationError(`sttProvider must be one of: ${STT_PROVIDERS.join(", ")}`);
  }
  if ("deploymentProfile" in patch && patch["deploymentProfile"] != null && !(DEPLOYMENT_PROFILES as readonly string[]).includes(patch["deploymentProfile"] as string)) {
    throw new SettingsValidationError(`deploymentProfile must be one of: ${DEPLOYMENT_PROFILES.join(", ")}`);
  }
  if ("reportingCurrency" in patch && patch["reportingCurrency"] != null) {
    const v = patch["reportingCurrency"];
    if (typeof v !== "string" || (v !== "" && !/^[A-Za-z]{3}$/.test(v))) {
      throw new SettingsValidationError("reportingCurrency must be a 3-letter ISO 4217 code (or null to clear)");
    }
    normalized["reportingCurrency"] = v.toUpperCase() || null;
  }
  if ("fxRatePolicy" in patch && !(FX_RATE_POLICIES as readonly string[]).includes(patch["fxRatePolicy"] as string)) {
    throw new SettingsValidationError(`fxRatePolicy must be one of: ${FX_RATE_POLICIES.join(", ")}`);
  }
  if ("fxRateAsOfDate" in patch && patch["fxRateAsOfDate"] != null) {
    const v = patch["fxRateAsOfDate"];
    if (typeof v !== "string" || (v !== "" && Number.isNaN(Date.parse(v)))) {
      throw new SettingsValidationError("fxRateAsOfDate must be an ISO 8601 date string (or null to clear)");
    }
    normalized["fxRateAsOfDate"] = v || null;
  }
  for (const key of ["brokerUrl", "oidcIssuerUrl"] as const) {
    if (key in patch && patch[key] != null) {
      if (typeof patch[key] !== "string") throw new SettingsValidationError(`${key} must be a string or null`);
      try {
        assertSafeOutboundUrl(patch[key] as string, key);
      } catch (err) {
        throw new SettingsValidationError(err instanceof UnsafeUrlError ? err.message : `${key} is invalid`);
      }
    }
  }
  if ("webhooks" in patch) validateWebhooks(patch["webhooks"]);
  if ("federatedPeers" in patch) validateFederatedPeers(patch["federatedPeers"]);
  if ("branding" in patch && patch["branding"] != null && typeof patch["branding"] !== "object") {
    throw new SettingsValidationError("branding must be an object or null");
  }
  if ("labelOverrides" in patch && (typeof patch["labelOverrides"] !== "object" || patch["labelOverrides"] == null)) {
    throw new SettingsValidationError("labelOverrides must be an object");
  }
  if ("disabledFeatures" in patch) {
    const v = patch["disabledFeatures"];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new SettingsValidationError("disabledFeatures must be an array of strings");
    }
  }
  if ("enabledFeatures" in patch) {
    const v = patch["enabledFeatures"];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new SettingsValidationError("enabledFeatures must be an array of strings");
    }
  }
  if ("featureGovernance" in patch) validateGovernance(patch["featureGovernance"], "featureGovernance");
  if ("programmeFeatures" in patch) validateScopeFeatureMap(patch["programmeFeatures"], "programmeFeatures");
  if ("projectFeatures" in patch) validateScopeFeatureMap(patch["projectFeatures"], "projectFeatures");
  if ("governanceRules" in patch) validateGovernanceRules(patch["governanceRules"], "governanceRules");
  if ("hiddenFields" in patch) {
    const v = patch["hiddenFields"];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new SettingsValidationError("hiddenFields must be an array of strings");
    }
  }
  if ("savedViews" in patch) validateSavedViews(patch["savedViews"]);
  if ("customReports" in patch) validateCustomReports(patch["customReports"]);
  if ("reportOverrides" in patch) validateReportOverrides(patch["reportOverrides"]);
  if ("contentPages" in patch) validateContentPages(patch["contentPages"]);
  if ("priorityWeights" in patch) validatePriorityWeights(patch["priorityWeights"]);
  if ("dashboards" in patch) validateDashboards(patch["dashboards"]);
  if ("fieldOverrides" in patch) validateFieldOverrides(patch["fieldOverrides"]);
  if ("loggingSync" in patch) validateLoggingSync(patch["loggingSync"]);
  if ("selfHost" in patch) validateSelfHost(patch["selfHost"]);
  return normalized;
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
  return { ...store };
}

// Apply the initial (env-seeded) profile to the runtime accessor at module load.
setRuntimeProfile(store.deploymentProfile ?? null);
