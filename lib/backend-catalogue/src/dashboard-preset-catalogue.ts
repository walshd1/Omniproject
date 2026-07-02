import { DASHBOARD_PRESETS_DATA } from "./dashboard-presets.generated";
import { widgetDef } from "./widget-catalogue";

/**
 * DASHBOARD-PRESET registry — ready-made, role-tailored "what needs me today" dashboards.
 *
 * A busy PM has minutes between meetings and wants ONE screen answering "what needs me today", not a
 * blank dashboard to build. A preset is a neutral manifest (authored as JSON under
 * assets/dashboard-presets/<id>.json, embedded by gen-dashboard-presets and drift-guarded in CI —
 * the same discipline as widgets/personas) that assembles EXISTING widget `type`s into a layout for
 * one role persona (head-of-projects / programme-manager / project-manager). Applying a preset mints
 * a fresh dashboard for the user.
 *
 * PURE + read-only: every widget in a preset reads through the existing read-model only; a preset
 * grants no new write path to project data. Each preset's widget `type`s must be real widgets —
 * kept honest by the preset-coverage guard (guard-dashboard-preset-coverage).
 */

/** The role personas a preset can be tailored to (drives the suggested default). */
export type PresetRole = "head-of-projects" | "programme-manager" | "project-manager";

/** A widget placed by a preset. `type` keys into the widget catalogue; `span` is the column width. */
export interface PresetWidget {
  type: string;
  span?: 1 | 2 | 3;
  title?: string;
}

export interface DashboardPreset {
  /** Unique preset id; equals the source filename. */
  id: string;
  /** The role persona this preset is tailored to. */
  role: PresetRole;
  /** The dashboard name minted when the preset is applied. */
  name: string;
  /** One-line "what needs me today" lens, shown in the preset picker. */
  summary: string;
  /** Display order in the preset picker. */
  order?: number;
  /** The placed widgets, in order. Every `type` is a real widget type (widget-coverage). */
  widgets: PresetWidget[];
}

/** Every shipped preset, in display order. Authored as JSON under assets/dashboard-presets/<id>.json
 *  and embedded by gen-dashboard-presets (drift-guarded in CI). */
export const DASHBOARD_PRESETS: DashboardPreset[] = [...DASHBOARD_PRESETS_DATA].sort(
  (a, b) => (a.order ?? 0) - (b.order ?? 0),
);

/** One preset by id, or undefined. */
export function dashboardPreset(id: string): DashboardPreset | undefined {
  return DASHBOARD_PRESETS.find((p) => p.id === id);
}

/** The first preset tailored to a role, or undefined — the suggested default for a user of that role. */
export function presetForRole(role: string): DashboardPreset | undefined {
  return DASHBOARD_PRESETS.find((p) => p.role === role);
}

/** All presets (a defensive copy). */
export function dashboardPresetCatalogue(): DashboardPreset[] {
  return DASHBOARD_PRESETS.map((p) => ({ ...p, widgets: p.widgets.map((w) => ({ ...w })) }));
}

/** The presets whose every widget the active backend can surface — drops any preset that needs an
 *  entity-gated widget the backend can't surface. `canSurface` mirrors the SPA capabilities predicate. */
export function availablePresets(canSurface: (entity: string) => boolean): DashboardPreset[] {
  return DASHBOARD_PRESETS.filter((p) =>
    p.widgets.every((w) => {
      const def = widgetDef(w.type);
      return !def?.requiresEntity || canSurface(def.requiresEntity);
    }),
  );
}
