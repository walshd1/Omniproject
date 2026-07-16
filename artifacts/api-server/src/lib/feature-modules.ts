import type { Request, Response, NextFunction, RequestHandler, IRouter } from "express";
import { REPORTS, METHODOLOGIES } from "@workspace/backend-catalogue";
import { SELF_HOST_DOMAINS, selfHostGovernanceId } from "../selfhost/domains";
import { getSettings } from "./settings";
import {
  resolveFeatures,
  type FeatureGate,
  type GateReason,
  type ResolvedFeature,
  type ScopeOverrides,
} from "./feature-resolution";
import { governanceOverridesFor } from "./governance-rules";
import { projectTypeFor } from "./rate-card-store";

/** A resolution scope: a project (and/or its programme). Omit both for org-level resolution. */
export interface FeatureScope {
  programmeId?: string | null;
  projectId?: string | null;
}

/**
 * Feature-module registry — the optional backend modules a deployment can switch off so a
 * customer never loads (or pays the resources for) code they don't use.
 *
 * The model:
 *   - **Opt-out.** Everything is ON by default; an operator disables modules by id, via
 *     `DISABLED_FEATURES=odata,integrations` (env) or `settings.disabledFeatures` (admin panel,
 *     persisted to the config bundle).
 *   - **Lazy backend loading.** Each module's route code is reached only through a dynamic
 *     `import()` (`load`). The mount step (`routes/index.ts`) runs that import ONLY for enabled
 *     modules, so a disabled module's chunk is never loaded/initialised at startup. esbuild
 *     code-splitting puts each behind its own chunk.
 *   - **Runtime toggle.** `requireFeature(id)` 404s a request the moment a module is disabled,
 *     even if its code is still resident from startup. Enabling a module that was OFF at startup
 *     takes effect on the next restart (it wasn't loaded) — surfaced as `needsRestart` in the
 *     status so the admin panel can say so honestly.
 *
 * Only genuinely-optional, self-contained modules belong here; core routes stay always-on.
 */
export interface FeatureModule {
  id: string;
  label: string;
  description: string;
  /** Advisory: a backend capability this module is most useful with (surfaced, not enforced). */
  requiresCapability?: string;
  /** Dynamic import of the backend route module — run only when enabled. OMITTED for a UI-only
   *  module (one whose feature is purely in the SPA, e.g. the editable grid): it has no backend
   *  route to mount, but is still listed + toggleable so the SPA can gate it via `useFeatures`. */
  load?: () => Promise<{ default: IRouter }>;
  /** OFF for everyone until the org opts in — a deliberate safety/cost/storage call (see `reason`).
   *  Everything else is ON by default. Drives the hierarchical gating model (feature-resolution). */
  defaultOff?: boolean;
  /** Why this module is default-off, surfaced to the admin so the opt-in is informed. */
  reason?: GateReason;
}

export const FEATURE_MODULES: readonly FeatureModule[] = [
  {
    id: "odata",
    label: "OData / BI feed",
    description: "Read-only OData + BI feeds for Power BI, Excel and analytics tools.",
    load: () => import("../routes/odata"),
    defaultOff: true,
    reason: "cost", // BI tools can pull large/repeated queries through the broker
  },
  {
    id: "integrations",
    label: "Integration helpers",
    description: "Outbound integration helper endpoints for connecting external tools.",
    load: () => import("../routes/integrations"),
    defaultOff: true,
    reason: "cost", // outbound egress to external tools
  },
  {
    // UI-only (no backend route): the editable data grid with bulk inline-edit. The SPA gates it
    // via useFeatures; writes go through the existing issue endpoints, so there's nothing to mount.
    id: "grid",
    label: "Editable data grid",
    description: "Spreadsheet-style grid with bulk inline editing of work items (write-through).",
  },
  {
    // UI-only: named saved views (filters/sort/columns/grouping). Persisted via /api/views to the
    // config bundle; the SPA gates it via useFeatures. No backend route to mount here.
    id: "savedViews",
    label: "Saved views",
    description: "Save named views (filters, sort, columns, grouping) and switch between them.",
  },
  {
    // UI-only: a personal "My Work" page (items assigned to me, cross-project) + an optional Inbox
    // fed by the existing notification stream. Reads through existing endpoints; nothing to mount.
    id: "myWork",
    label: "My Work / Inbox",
    description: "A personal cross-project view of items assigned to you, plus a notification inbox.",
  },
  {
    // UI-only: a configurable dashboard builder — compose named dashboards from a widget catalogue
    // (portfolio health, trends, recent activity, counts). Persisted via /api/dashboards to the
    // config bundle; the SPA gates it via useFeatures. Reads through existing endpoints.
    id: "dashboards",
    label: "Custom dashboards",
    description: "Build named dashboards from a catalogue of widgets (health, trends, activity, counts).",
  },
  {
    // UI-only: named content pages — compose free-form content from the unified component library
    // (reports + widgets, componentsFor("content")) as a flat ordered list. Persisted via
    // /api/content-pages to the config bundle; the SPA gates it via useFeatures. Reads through the
    // existing report/widget renderers only; nothing new to mount.
    id: "contentPages",
    label: "Content pages",
    description: "Compose named pages from the unified report + widget component library.",
  },
  {
    // UI-only: a slide-over work-item detail panel — quick-view fields, inline edit through the
    // existing issue-update endpoint (with optimistic-concurrency), and recent activity. The SPA
    // gates it via useFeatures; no backend route to mount.
    id: "sidePanel",
    label: "Rich side-panel",
    description: "A slide-over work-item detail panel with inline edit and recent activity.",
  },
  {
    // UI-only: a command-palette-style cross-entity quick-find over projects/issues/programmes from
    // the existing read-model. Keyboard-first; the SPA gates it via useFeatures; nothing to mount.
    id: "globalSearch",
    label: "Global search",
    description: "Fast cross-entity quick-find over projects, issues and programmes.",
  },
  {
    // JQL search TOOL (MCP): a rich Jira-style query over the caller's scope-bounded work items,
    // evaluated in the read model (lib/jql). Default-OFF: a powerful cross-project query surface an
    // admin opts into. No backend route to mount — it gates the MCP `search_issues` tool via its `feature`.
    id: "jqlSearch",
    label: "JQL search",
    description: "Rich Jira-style query language (JQL) for searching work items, exposed as an AI/MCP tool.",
    defaultOff: true,
    reason: "cost", // rich cross-project queries can scan the whole scoped portfolio
  },
  {
    // Live collaboration: per-surface presence + advisory, soft-TTL field "locks" over SSE. Has a
    // backend route (the SSE stream + heartbeat) so it loads lazily; the SPA gates it via useFeatures.
    id: "presence",
    label: "Live collaboration presence",
    description: "See who else is on a work item and which field they're editing (advisory, real-time).",
    load: () => import("../routes/presence"),
    defaultOff: true,
    reason: "cost", // holds an SSE stream per viewer; per-replica in-memory rooms
  },
  {
    // Collaboration: comment threads + @mentions on a work item. Comments live in the ephemeral
    // shared-state seam (in memory by default, fleet-wide with Redis); durability is an opt-in
    // write-through to the backend (COMMENT_PERSISTENCE=backend). Has a backend route, so it loads
    // lazily; the SPA gates it via useFeatures.
    id: "comments",
    label: "Comments & @mentions",
    description: "Discuss a work item in a thread and @mention teammates (real-time notification).",
    load: () => import("../routes/comments"),
    defaultOff: true,
    reason: "storage", // holds comment state in the shared-state seam (soft, opt-in write-through)
  },
  {
    // Real-time collaborative EDITING of wiki documents (Yjs CRDT over an SSE relay). The server is a dumb
    // fan-out — the durable doc still saves through the broker seam; the CRDT stream is transient. Has a
    // backend route (the relay), so it loads lazily; OFF until opted in (holds an SSE stream per editor).
    id: "wikiCoEdit",
    label: "Wiki co-editing",
    description: "Edit a wiki document together in real time, with each other's changes merging live (CRDT).",
    load: () => import("../routes/collab"),
    defaultOff: true,
    reason: "cost", // holds an SSE stream per editor; per-replica in-memory relay rooms
  },
  {
    // Visual whiteboards / canvas. Scenes live in the backend through the broker seam (zero-at-rest);
    // has a backend route, so it loads lazily; OFF until opted in (the canvas editor is a heavy surface).
    id: "whiteboard",
    label: "Whiteboards",
    description: "Freeform visual canvases (sticky notes, shapes, connectors) stored through the data seam.",
    load: () => import("../routes/whiteboard"),
    defaultOff: true,
    reason: "cost",
  },
  {
    // Browser Web Push: deliver personal notifications to a user's device even when the PWA is closed, on
    // top of the in-app SSE + external channels. Has a backend route (subscribe/unsubscribe/vapid-key), so it
    // loads lazily; OFF until opted in AND VAPID keys are configured (VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT).
    id: "pushNotifications",
    label: "Push notifications",
    description: "Send personal notifications to a user's device via browser push (works when the app is closed).",
    load: () => import("../routes/push"),
    defaultOff: true,
    reason: "cost", // holds per-device subscriptions + sends outbound to push services
  },
  {
    // Proofing / deliverable review: a proof references an image/PDF (never inlined — zero-at-rest) and
    // carries annotation primitives + a review decision, held in the encrypted-JSON store. Has a backend
    // route, so it loads lazily; OFF until opted in.
    id: "proofing",
    label: "Proofing & review",
    description: "Attach a deliverable (image/PDF), pin annotations, and record an approve/reject decision.",
    load: () => import("../routes/proofs"),
    defaultOff: true,
    reason: "storage", // holds proof + annotation metadata in the encrypted-JSON store
  },
  {
    id: "goals",
    label: "Goals & OKRs",
    description: "First-class objectives with measurable key results, progress roll-up, and check-ins.",
    load: () => import("../routes/goals"),
    defaultOff: true,
    reason: "storage", // holds goal + key-result data in the encrypted-JSON store
  },
  {
    id: "timeTracking",
    label: "Live time tracking",
    description: "A start/stop timer that books elapsed time into a timesheet entry; billing-ready.",
    load: () => import("../routes/timer"),
    defaultOff: true,
    reason: "cost", // ephemeral per-user timer state in the shared-state KV
  },
  {
    id: "invoicing",
    label: "Invoicing",
    description: "Generate client-facing invoices with typed line items, derived totals and a status flow.",
    load: () => import("../routes/invoices"),
    defaultOff: true,
    reason: "storage", // holds invoice data in the encrypted-JSON store
  },
  {
    id: "marketplace",
    label: "Plugin marketplace",
    description: "Install org-wide extensions that contribute pure-JSON reports, pages, dashboards and screens.",
    load: () => import("../routes/marketplace"),
    defaultOff: true,
    reason: "storage", // holds installed-extension config in the encrypted-JSON store; install is admin-gated
  },
  {
    id: "registry",
    label: "Approved-items registry",
    description: "An org store of approved bespoke templates, reports, primitives and JSON defs, with optional community release.",
    load: () => import("../routes/registry"),
    defaultOff: true,
    reason: "storage", // holds curated registry items in the encrypted-JSON store; review/release admin-gated
  },
  {
    // Admin bulk-action runner: apply one canonical broker write (create/update project) to many
    // projects at once, declaratively. Has a backend route (POST /api/admin/bulk), so it loads
    // lazily; OFF until an admin opts in — it fans out project-level writes (high blast radius), so
    // it stays gated behind the feature toggle + requireRole("manager") + step-up on the route.
    id: "bulkActions",
    label: "Bulk actions",
    description: "Apply a canonical write (create/update project) to many projects at once, with a dry-run preview.",
    load: () => import("../routes/bulk"),
    defaultOff: true,
    reason: "safety", // fans out project-level writes — high blast radius, opt-in only
  },
  {
    // UI-only: makes the per-user ENCRYPTED OFFLINE CACHE toggle AVAILABLE (off by default per user). When
    // on, the my-work/tasks read models are cached in IndexedDB, AES-256-GCM encrypted with a session-scoped
    // NON-EXTRACTABLE WebCrypto key, TTL'd, and wiped on logout — so the app opens with my work while offline
    // without weakening zero-at-rest (nothing plaintext at rest, nothing survives the session). Nothing to
    // mount — the SPA gates it via useFeatures; an operator can forbid on-device data org-wide by disabling it.
    id: "offlineCache",
    label: "Offline cache (my work)",
    description: "Cache your my-work/tasks read models on-device (encrypted, ephemeral) so they open offline.",
    defaultOff: true,
    reason: "storage", // holds encrypted read-model data on the device (opt-in, wiped on logout)
  },
  {
    // UI-only: makes the per-user PREDICTIVE (speculative) prefetch toggle AVAILABLE (off by default
    // per user). Deterministic prefetch-on-intent (hover/focus) is always on and ungated; this only
    // governs the heavier "warm data you haven't asked for" tier, which multiplies broker calls — so
    // an operator can remove the toggle org-wide by disabling this module. Nothing to mount.
    id: "predictivePrefetch",
    label: "Predictive loading (preview)",
    description: "Offer a per-user toggle for speculative read-ahead beyond hover/focus (extra broker load).",
    defaultOff: true,
    reason: "cost", // speculative read-ahead multiplies broker calls
  },
];


/** Memoize a zero-arg computation — compute it once, on first call, and cache the result. The
 *  shared shape behind `governanceCatalogue`/`governanceGates`'s "pure over static imports, so
 *  build it once at module scope instead of on every gated request" memoization. */
function lazy<T>(compute: () => T): () => T {
  let cached: T | undefined;
  let computed = false;
  return () => {
    if (!computed) {
      cached = compute();
      computed = true;
    }
    return cached as T;
  };
}

/** A kind of governable item: an optional module, a report, a methodology, or a self-host DB domain. */
export type GovernanceKind = "module" | "report" | "methodology" | "selfhost";

export interface GovernanceItem {
  id: string;
  kind: GovernanceKind;
  label: string;
  description: string;
  defaultOff?: boolean;
  reason?: GateReason;
}

// Memoized below — pure over the static FEATURE_MODULES/REPORTS/METHODOLOGIES imports, so it's
// built ONCE at module scope instead of rebuilt (+ ~10 Sets reallocated) on every gated request.
// `scopeOverrides()` stays per-call: it reads live settings/env, which genuinely vary per request.
// See docs/PERF-PATTERNS-REVIEW.md, Theme B.
const computeGovernanceCatalogue = lazy((): GovernanceItem[] => {
  const modules: GovernanceItem[] = FEATURE_MODULES.map((m) => ({
    id: m.id, kind: "module", label: m.label, description: m.description,
    ...(m.defaultOff ? { defaultOff: true } : {}), ...(m.reason ? { reason: m.reason } : {}),
  }));
  const reports: GovernanceItem[] = REPORTS.map((r) => ({
    id: `report:${r.id}`, kind: "report", label: r.label, description: `${r.kind} report`,
  }));
  const methodologies: GovernanceItem[] = METHODOLOGIES.map((m) => ({
    id: `methodology:${m.id}`, kind: "methodology", label: m.label, description: `${m.kind} methodology`,
  }));
  // Self-host DB domains — governed like any feature so a PMO can mandate/forbid holding a domain in
  // the operator's own database. Gated (non-core) domains carry their storage/cost `defaultOff` posture
  // so adoption is an explicit opt-in; the core work-item domain is default-on. See selfhost/domains.
  const selfhost: GovernanceItem[] = SELF_HOST_DOMAINS.map((d) => ({
    id: selfHostGovernanceId(d.id), kind: "selfhost", label: `Self-host: ${d.label}`, description: d.unlocks,
    ...(d.core ? {} : { defaultOff: true }), ...(d.gate ? { reason: d.gate } : {}),
  }));
  return [...modules, ...reports, ...methodologies, ...selfhost];
});

/**
 * The full governance catalogue: the feature modules PLUS every shipped report and methodology, so a
 * PMO can mandate ("must use") or forbid ("must not use") any of them through the same resolver.
 * Reports/methodologies are namespaced (`report:<id>` / `methodology:<id>`) so their ids never clash
 * with a module id; they're default-ON (no safety/cost/storage concern of their own).
 */
export function governanceCatalogue(): GovernanceItem[] {
  return computeGovernanceCatalogue();
}

// Memoized alongside governanceCatalogue, for the same reason.
const computeGovernanceGates = lazy((): FeatureGate[] =>
  governanceCatalogue().map((g) => ({
    id: g.id,
    ...(g.defaultOff ? { defaultOff: true } : {}),
    ...(g.reason ? { reason: g.reason } : {}),
  })),
);

/** The governance catalogue as resolver gates (id + default posture). */
export function governanceGates(): FeatureGate[] {
  return computeGovernanceGates();
}

// Which modules actually got loaded+mounted this process (set by the mount step). Lets the
// status distinguish "enabled and live" from "enabled but was off at startup → needs restart".
const loaded = new Set<string>();
export function markFeatureLoaded(id: string): void {
  loaded.add(id);
}

/**
 * The context conditional governance rules evaluate against. Restricted to the facts available
 * **synchronously in every resolution path** (read AND enforce) — programme, project, and the project's
 * type — so a rule resolves identically when the SPA reads status and when `requireFeature` enforces at
 * action time. (Richer facts like budget need an async project read; those rules are rejected at
 * authoring time so a rule can never be hidden in the UI yet allowed by the API.)
 */
function governanceContext(scope: FeatureScope): Record<string, unknown> {
  const projectId = scope.projectId ?? null;
  return { programmeId: scope.programmeId ?? null, projectId, projectType: projectId ? projectTypeFor(projectId) : null };
}

/** Build the resolver's scope overrides from settings + the requested programme/project. Conditional
 *  governance rules that match the scope's context are folded into the ORG level (they can only add
 *  require/forbid/disable for matching contexts — never grant beyond org, so monotonicity holds). */
export function scopeOverrides(scope: FeatureScope = {}): ScopeOverrides {
  const s = getSettings();
  const prog = scope.programmeId ? s.programmeFeatures?.[scope.programmeId] : undefined;
  const proj = scope.projectId ? s.projectFeatures?.[scope.projectId] : undefined;
  const ruleOv = governanceOverridesFor(s.governanceRules ?? [], governanceContext(scope));
  return {
    orgDisabled: [...(s.disabledFeatures ?? []), ...ruleOv.disabled],
    orgEnabled: s.enabledFeatures ?? [],
    orgRequired: [...(s.featureGovernance?.required ?? []), ...ruleOv.required],
    orgForbidden: [...(s.featureGovernance?.forbidden ?? []), ...ruleOv.forbidden],
    programmeDisabled: prog?.disabled ?? [],
    programmeRequired: prog?.required ?? [],
    programmeForbidden: prog?.forbidden ?? [],
    projectDisabled: proj?.disabled ?? [],
    projectRequired: proj?.required ?? [],
    projectForbidden: proj?.forbidden ?? [],
  };
}

/** Resolve every governable item (modules + reports + methodologies) for a scope, with lock detail. */
export function resolveScopedFeatures(scope: FeatureScope = {}): ResolvedFeature[] {
  return resolveFeatures(governanceGates(), scopeOverrides(scope));
}

/**
 * True when a module id is enabled for the given scope (org by default). Honours `defaultOff`
 * opt-in and the org→programme→project hierarchy + PMO mandates (see lib/feature-resolution).
 */
export function isFeatureEnabled(id: string, scope: FeatureScope = {}): boolean {
  const r = resolveScopedFeatures(scope).find((f) => f.id === id);
  // Unknown ids (not in the registry) are treated as enabled — gating only governs known modules.
  return r ? r.enabled : true;
}

export interface FeatureStatus {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  /** Loaded + mounted this process (enabled at startup). */
  loaded: boolean;
  /** Enabled now but not loaded — was off at startup, so a restart is needed to load it. */
  needsRestart: boolean;
  /** OFF for everyone until the org opts in (a safety/cost/storage call) — metadata for the admin UI. */
  defaultOff: boolean;
  /** Why it's default-off. */
  reason?: GateReason;
  /** A hard governance mandate locked this state — descendants can't change it. */
  locked?: boolean;
  lockedBy?: "org" | "programme" | "project";
  policy?: "require" | "forbid";
  /** When disabled, the level that turned it off. */
  blockedAt?: "org" | "programme" | "project";
  /** Whether this is an optional module, a report, or a methodology. */
  kind: GovernanceKind;
}

/** The status of every governable item (modules + reports + methodologies) for a scope. */
export function featureStatus(scope: FeatureScope = {}): FeatureStatus[] {
  const resolved = new Map(resolveScopedFeatures(scope).map((r) => [r.id, r]));
  return governanceCatalogue().map((g) => {
    const r = resolved.get(g.id);
    const enabled = r ? r.enabled : true;
    // Only optional modules have a route chunk that can be loaded/needs-restart; reports/methodologies
    // are presentation/config and are "live" client-side whenever enabled.
    const backend = g.kind === "module" && !!FEATURE_MODULES.find((m) => m.id === g.id)?.load;
    const isLoaded = loaded.has(g.id);
    return {
      id: g.id,
      kind: g.kind,
      label: g.label,
      description: g.description,
      enabled,
      loaded: backend ? isLoaded : enabled,
      needsRestart: backend && enabled && !isLoaded,
      defaultOff: !!g.defaultOff,
      ...(g.reason ? { reason: g.reason } : {}),
      ...(r?.locked ? { locked: true, lockedBy: r.lockedBy, policy: r.policy } : {}),
      ...(r && !r.enabled && r.blockedAt ? { blockedAt: r.blockedAt } : {}),
    };
  });
}

/**
 * Middleware: 404 when the feature is disabled for the request's scope. Reads a `projectId` route
 * param (and resolves its programme if the request carries one) so a project-scoped disable/forbid
 * actually blocks the endpoint — not just the UI. Falls back to org scope when there's no project.
 */
export function requireFeature(id: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const projectId = (req.params?.["projectId"] as string | undefined) || null;
    const programmeId = (req.params?.["programmeId"] as string | undefined) || null;
    if (isFeatureEnabled(id, { projectId, programmeId })) {
      next();
      return;
    }
    res.status(404).json({ error: "This feature is not enabled." });
  };
}
