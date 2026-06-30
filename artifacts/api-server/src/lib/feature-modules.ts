import type { Request, Response, NextFunction, RequestHandler, IRouter } from "express";
import { getSettings } from "./settings";
import type { FeatureGate, GateReason } from "./feature-resolution";

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

/** The registry as pure feature-gates (id + default posture) for the hierarchical resolver. */
export function featureGates(): FeatureGate[] {
  return FEATURE_MODULES.map((m) => ({
    id: m.id,
    ...(m.defaultOff ? { defaultOff: true } : {}),
    ...(m.reason ? { reason: m.reason } : {}),
  }));
}

// Which modules actually got loaded+mounted this process (set by the mount step). Lets the
// status distinguish "enabled and live" from "enabled but was off at startup → needs restart".
const loaded = new Set<string>();
export function markFeatureLoaded(id: string): void {
  loaded.add(id);
}

/** The full set of disabled ids: env (`DISABLED_FEATURES`) ∪ settings (`disabledFeatures`). */
export function disabledFeatureIds(): Set<string> {
  const out = new Set<string>();
  for (const id of getSettings().disabledFeatures ?? []) out.add(id);
  return out;
}

/** True when a module id is currently enabled (not in the disabled set). */
export function isFeatureEnabled(id: string): boolean {
  return !disabledFeatureIds().has(id);
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
}

/** The status of every registered feature module (for `GET /api/features` + the admin panel). */
export function featureStatus(): FeatureStatus[] {
  const disabled = disabledFeatureIds();
  return FEATURE_MODULES.map((m) => {
    const enabled = !disabled.has(m.id);
    const backend = !!m.load; // UI-only modules have no backend route to load
    const isLoaded = loaded.has(m.id);
    return {
      id: m.id,
      label: m.label,
      description: m.description,
      enabled,
      // UI-only modules are "live" purely client-side when enabled; only a backend module can be
      // enabled-but-not-loaded (→ needs a restart to load its route chunk).
      loaded: backend ? isLoaded : enabled,
      needsRestart: backend && enabled && !isLoaded,
      defaultOff: !!m.defaultOff,
      ...(m.reason ? { reason: m.reason } : {}),
    };
  });
}

/** Middleware: 404 when the feature is disabled at request time (immediate runtime toggle-off). */
export function requireFeature(id: string): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (isFeatureEnabled(id)) {
      next();
      return;
    }
    res.status(404).json({ error: "This feature is not enabled." });
  };
}
