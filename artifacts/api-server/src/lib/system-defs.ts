import { reportCatalogue, formCatalogue, dashboardDefCatalogue, referenceRulesetCatalogue, methodologyCatalogue, screenDefCatalogue, primitiveCatalogue, mappingCatalogue, workVocabularyValues, taskVocabularyValues, energyVocabularyValues } from "@workspace/backend-catalogue";
import { WORK_VOCABULARY_CONFIG_ID } from "./work-vocabulary-config";
import { TASK_VOCABULARY_CONFIG_ID } from "./task-vocabulary-config";
import { ENERGY_VOCABULARY_CONFIG_ID } from "./energy-vocabulary-config";
import { DEF_SCOPE_POLICY_CONFIG_ID, DEFAULT_DEF_SCOPE_POLICY } from "./def-policy";
import { PRESETS_CONFIG_ID, presetConfigValues } from "./preset-config";
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
  // Screens — including the methodology overview screens, which are ordinary catalogue screens authored purely
  // from atom-composable primitive panels (a canvas + chart/table/register/…). No special path: they seed here
  // like every other screen, and their ancestor primitive defs are committed in the same sealed write below.
  for (const s of screenDefCatalogue()) rows.push(buildSystemDefRow("screen", String(s.label), s, SEED_AT));
  for (const p of primitiveCatalogue()) rows.push(buildSystemDefRow("primitive", p.label, p, SEED_AT));
  // The shipped CORE field mappings (roadmap §4.6) — authored as JSON under assets/mappings/, seeded into the
  // system store, overridable by org/programme/project/user through the importer. The SAME catalogue the
  // resolver uses as its store-off fallback layer (one JSON source of truth, no TS mapping constants).
  for (const m of mappingCatalogue()) rows.push(buildSystemDefRow("mapping", m.label, m, SEED_AT));
  // The canonical work-item vocabulary (statuses + priorities) — authored as JSON
  // (assets/work-vocabulary.json), seeded here as the SYSTEM-scope `work-vocabulary` config def: the base
  // layer the scope resolver folds org/programme/project/user overrides onto (see work-vocabulary-config).
  // Sourced from the SAME catalogue accessor the build-time consumers export, so the base can't drift.
  rows.push(buildSystemDefRow("config", "Work vocabulary", { id: WORK_VOCABULARY_CONFIG_ID, values: workVocabularyValues() }, SEED_AT));
  // The canonical GTD TASK-status vocabulary (next-actions axis, distinct from the work-item/issue axis) —
  // authored as JSON (assets/task-vocabulary.json), seeded here as the SYSTEM-scope `task-vocabulary` config
  // def: the base layer the scope resolver folds org/programme/project/user overrides onto (see
  // task-vocabulary-config). Sourced from the SAME catalogue accessor the write-path uses, so it can't drift.
  rows.push(buildSystemDefRow("config", "Task vocabulary", { id: TASK_VOCABULARY_CONFIG_ID, values: taskVocabularyValues() }, SEED_AT));
  // The canonical GTD ENERGY-level vocabulary (the "how much have I got in the tank" axis, orthogonal to an
  // hour estimate) — authored as JSON (assets/energy-vocabulary.json), seeded here as the SYSTEM-scope
  // `energy-vocabulary` config def: the base layer the scope resolver folds org/programme/project/user
  // overrides onto (see energy-vocabulary-config). Sourced from the SAME catalogue accessor the write-path
  // uses, so it can't drift.
  rows.push(buildSystemDefRow("config", "Energy vocabulary", { id: ENERGY_VOCABULARY_CONFIG_ID, values: energyVocabularyValues() }, SEED_AT));
  // The definition-write POLICY LEVELS (which role each scope needs to write a def) — the baseline as a system
  // `config` def, scope-overridable via copy-and-override (an org tightens/relaxes per key). The ENFORCEMENT
  // stays in code (def-policy.ts); only the levels are data.
  rows.push(buildSystemDefRow("config", "Definition write policy", { id: DEF_SCOPE_POLICY_CONFIG_ID, values: DEFAULT_DEF_SCOPE_POLICY }, SEED_AT));
  // The quick-load PRESETS — the shipped bundles seeded as the system-scope `presets` config def (a `list` of
  // presets), the base layer the scope resolver folds org/programme/project/user overrides onto (merge by id).
  // Presets are DATA in system JSON, copy-and-overridable like every other catalogue (see preset-config).
  rows.push(buildSystemDefRow("config", "Presets", { id: PRESETS_CONFIG_ID, values: presetConfigValues() }, SEED_AT));
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
