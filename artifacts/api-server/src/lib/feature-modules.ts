import type { Request, Response, NextFunction, RequestHandler, IRouter } from "express";
import { getSettings } from "./settings";

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
}

export const FEATURE_MODULES: readonly FeatureModule[] = [
  {
    id: "odata",
    label: "OData / BI feed",
    description: "Read-only OData + BI feeds for Power BI, Excel and analytics tools.",
    load: () => import("../routes/odata"),
  },
  {
    id: "integrations",
    label: "Integration helpers",
    description: "Outbound integration helper endpoints for connecting external tools.",
    load: () => import("../routes/integrations"),
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
];

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
