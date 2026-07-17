import { reportCatalogue, formCatalogue, dashboardPresetCatalogue, referenceRulesetCatalogue, type DashboardPreset } from "@workspace/backend-catalogue";
import { artifactStoreEnabled } from "./artifact-store";
import { buildSystemDefRow, replaceSystemDefs, listSystemDefs, type StoredDef } from "./def-import";

/**
 * THE SHIPPED-DEFAULTS INSTALLER for the read-only system store (roadmap X.11). Our built-in defaults — reports,
 * forms, business-rule reference bundles, dashboard presets — are sourced from OUR bundled catalogues in
 * `@workspace/backend-catalogue` (the approved-from-us source; a customer can't inject into this tier). They are
 * sealed into the `system` def blob in a SINGLE one-shot write (`replaceSystemDefs`), never per-item.
 *
 * Two entry points, both applying the SAME bundled set:
 *   - `seedSystemDefaultsIfEmpty()` — auto-install on first boot (empty system store). Updates are NOT automatic.
 *   - `applySystemDefaults()`       — the one-shot (re)apply the admin-gated approved-update route calls.
 *
 * Screens + primitives are NOT here yet: their shipped defaults live only in the SPA and must be relocated into
 * the shared package before the backend seeder can source them.
 */

/** Deterministic stamp for shipped defaults (not per-boot), so the sealed set is stable across installs. */
const SEED_AT = "2026-01-01T00:00:00.000Z";

/** A dashboard PRESET (`{ widgets: [{ type, span?, title? }] }`) → the dashboard def payload the renderer wants
 *  (`{ id, name, widgets: [{ id, type, span?, title? }] }`), synthesising each widget's required `id`. */
function presetToDashboardPayload(p: DashboardPreset): { id: string; name: string; widgets: Array<{ id: string; type: string; span?: number; title?: string }> } {
  return {
    id: p.id,
    name: p.name,
    widgets: p.widgets.map((w, i) => ({ id: `${w.type}-${i}`, type: w.type, ...(w.span ? { span: w.span } : {}), ...(w.title ? { title: w.title } : {}) })),
  };
}

/** Build the FULL shipped-default def set from the bundled catalogues (the approved-from-us content). */
export function buildSystemDefaultRows(): StoredDef[] {
  const rows: StoredDef[] = [];
  for (const r of reportCatalogue()) rows.push(buildSystemDefRow("report", r.label, r, SEED_AT));
  for (const f of formCatalogue()) rows.push(buildSystemDefRow("form", f.label, f, SEED_AT));
  for (const b of referenceRulesetCatalogue()) rows.push(buildSystemDefRow("businessRule", b.label, b, SEED_AT));
  for (const p of dashboardPresetCatalogue()) rows.push(buildSystemDefRow("dashboard", p.name, presetToDashboardPayload(p), SEED_AT));
  return rows;
}

/** One-shot (re)apply of the bundled defaults into the system store — decrypt→replace→re-encrypt in ONE write. */
export function applySystemDefaults(): { count: number } {
  const rows = buildSystemDefaultRows();
  replaceSystemDefs(rows);
  return { count: rows.length };
}

/** Auto-install on first boot only (empty system store). Later changes to the shipped defaults are applied by
 *  the admin-gated approved-update route, not silently on every boot. No-op when the store is disabled. */
export function seedSystemDefaultsIfEmpty(): { seeded: boolean; count: number } {
  if (!artifactStoreEnabled()) return { seeded: false, count: 0 };
  if (listSystemDefs().length > 0) return { seeded: false, count: 0 };
  return { seeded: true, ...applySystemDefaults() };
}
