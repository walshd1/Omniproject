import { reportCatalogue, formCatalogue, dashboardDefCatalogue, referenceRulesetCatalogue, methodologyCatalogue, screenDefCatalogue, primitiveCatalogue, mappingCatalogue, workVocabulary } from "@workspace/backend-catalogue";
import { artifactStoreEnabled } from "./artifact-store";
import { buildSystemDefRow, replaceSystemDefs, listSystemDefs, type StoredDef } from "./def-import";

/**
 * THE SHIPPED-DEFAULTS INSTALLER for the read-only system store (roadmap X.11). Our built-in defaults — reports,
 * forms, business-rule reference bundles, methodologies, dashboard presets — are sourced from OUR bundled catalogues in
 * `@workspace/backend-catalogue` (the approved-from-us source; a customer can't inject into this tier). They are
 * sealed into the `system` def blob in a SINGLE one-shot write (`replaceSystemDefs`), never per-item.
 *
 * Two entry points, both applying the SAME bundled set:
 *   - `seedSystemDefaultsIfEmpty()` — auto-install on first boot (empty system store). Updates are NOT automatic.
 *   - `applySystemDefaults()`       — the one-shot (re)apply the admin-gated approved-update route calls.
 *
 * SCREENS are now seeded here too (relocated into the shared package so the ENGINE and the screen ARTIFACTS
 * are separate — X.11). Primitives follow in their own slice.
 */

/** Deterministic stamp for shipped defaults (not per-boot), so the sealed set is stable across installs. */
const SEED_AT = "2026-01-01T00:00:00.000Z";

/** Build the FULL shipped-default def set from the bundled catalogues (the approved-from-us content). */
export function buildSystemDefaultRows(): StoredDef[] {
  const rows: StoredDef[] = [];
  for (const r of reportCatalogue()) rows.push(buildSystemDefRow("report", r.label, r, SEED_AT));
  for (const f of formCatalogue()) rows.push(buildSystemDefRow("form", f.label, f, SEED_AT));
  for (const b of referenceRulesetCatalogue()) rows.push(buildSystemDefRow("businessRule", b.label, b, SEED_AT));
  for (const m of methodologyCatalogue()) rows.push(buildSystemDefRow("methodology", m.label, m, SEED_AT));
  for (const d of dashboardDefCatalogue()) rows.push(buildSystemDefRow("dashboard", d.name, d, SEED_AT));
  for (const s of screenDefCatalogue()) rows.push(buildSystemDefRow("screen", String(s.label), s, SEED_AT));
  for (const p of primitiveCatalogue()) rows.push(buildSystemDefRow("primitive", p.label, p, SEED_AT));
  // The shipped CORE field mappings (roadmap §4.6) — authored as JSON under assets/mappings/, seeded into the
  // system store, overridable by org/programme/project/user through the importer. The SAME catalogue the
  // resolver uses as its store-off fallback layer (one JSON source of truth, no TS mapping constants).
  for (const m of mappingCatalogue()) rows.push(buildSystemDefRow("mapping", m.label, m, SEED_AT));
  // The canonical work-item vocabulary (statuses + priorities) — authored as JSON
  // (assets/work-vocabulary.json) and ALSO seeded here as a read-only `config` def, so the canonical set
  // is derived from the system JSON store like every other shipped default (visible, exported, backed up
  // in one place). It is the SAME catalogue the build-time accessor exports, so the two can't drift; the
  // set stays fixed (the neutral wire contract backends normalise into) — seeded at system scope only.
  rows.push(buildSystemDefRow("config", "Work vocabulary", buildWorkVocabularyConfig(), SEED_AT));
  return rows;
}

/** The read-only work-vocabulary `config` def payload: the canonical statuses + priorities grouped by
 *  kind, sourced from the shared catalogue (one source of truth with the build-time accessor). */
function buildWorkVocabularyConfig(): { id: string; values: Record<string, unknown> } {
  const vocab = workVocabulary();
  const forKind = (kind: "status" | "priority") =>
    vocab.filter((e) => e.kind === kind).map((e) => ({ id: e.id, label: e.label, order: e.order, ...(e.lifecycle ? { lifecycle: e.lifecycle } : {}) }));
  return { id: "work-vocabulary", values: { statuses: forKind("status"), priorities: forKind("priority") } };
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
