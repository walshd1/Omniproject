import { composeExtends } from "./def-compose";
import { resolvePrimitive, getPrimitive } from "./primitive-catalogue";
import type { RawScreenDef } from "./screen-def-catalogue";
import scrum from "./methodology-artifacts/scrum-overview.json";
import kanban from "./methodology-artifacts/kanban-overview.json";
import scrumban from "./methodology-artifacts/scrumban-overview.json";
import waterfall from "./methodology-artifacts/waterfall-overview.json";
import prince2 from "./methodology-artifacts/prince2-overview.json";
import safe from "./methodology-artifacts/safe-overview.json";
import grantTracking from "./methodology-artifacts/grant-tracking-overview.json";
import volunteerRoster from "./methodology-artifacts/volunteer-roster-overview.json";
import fundraisingPipeline from "./methodology-artifacts/fundraising-pipeline-overview.json";

/**
 * CANONICAL METHODOLOGY ARTIFACTS — one shipped, read-only overview screen per methodology, authored as pure
 * JSON RECIPES (`methodology-artifacts/*.json`), NOT TypeScript. The proof they are built from the atoms is not
 * a type assertion — it is a RENDER: each JSON recipe is run through the resolver ({@link renderArtifact}: flatten
 * its `extends` chain, then resolve every panel to the primitive family it renders through and expand THAT to its
 * tree root), and the rendered output is checked against the CANONICAL STANDARD ({@link canonicalErrors}: a valid
 * screen shape + every panel resolving to its expected root — visuals → `canvas`, data → `record`, atoms at their
 * own root). Only recipes that pass are returned by {@link methodologyArtifacts}, so ONLY a canonically-valid
 * recipe is ever seeded into the system store — and its ANCESTOR primitive recipes ({@link methodologyArtifactAncestors})
 * are seeded alongside it (guaranteed present as primitive defs), so the committed screen is self-contained.
 */

/**
 * A screen panel's `kind` → the primitive family it renders through. Only atom-composable kinds appear; a kind
 * absent here is a bespoke escape hatch (`view`/`component`/…) not expressed as an atom composition, and a recipe
 * using one fails the canonical check.
 */
export const PANEL_PRIMITIVE: Record<string, string> = {
  chart: "chart",
  table: "table",
  register: "register",
  tile: "tile",
  metric: "stat-tile",
  field: "field",
  form: "form",
  geometry: "geometry-canvas",
  text: "label",
};

/** Each panel-family primitive must bottom out at the RIGHT tree root — the canonical standard a rendered panel
 *  is measured against. Visuals → `canvas`; data → `record`; the cross-cutting atoms at their own root. */
export const EXPECTED_ROOT: Record<string, string> = {
  chart: "canvas",
  table: "canvas",
  form: "canvas",
  "geometry-canvas": "canvas",
  register: "record",
  "stat-tile": "tile",
  field: "field",
  label: "label",
};

/** The raw JSON recipes, in catalogue order. Authored on disk; never a TS literal. */
export const METHODOLOGY_ARTIFACT_RECIPES: RawScreenDef[] = [
  scrum, kanban, scrumban, waterfall, prince2, safe, grantTracking, volunteerRoster, fundraisingPipeline,
] as unknown as RawScreenDef[];

const RECIPE_BY_ID = new Map(METHODOLOGY_ARTIFACT_RECIPES.map((r) => [r.id, r]));

/** One panel after rendering — the primitive family it renders through, expanded to its lineage + root. */
export interface RenderedPanel {
  id: string;
  kind: string;
  /** The primitive family the kind maps to (undefined = a bespoke escape hatch, not atom-composable). */
  primitive?: string;
  /** The primitive's composition chain, leaf → root. */
  lineage?: string[];
  /** The tree root the panel bottoms out at. */
  root?: string;
}

/** A recipe after rendering — its panels expanded to primitives, plus the ancestor primitive ids it depends on. */
export interface RenderedArtifact {
  id: string;
  label: string;
  methodologies: string[];
  panels: RenderedPanel[];
  /** Every primitive id in the transitive lineage of every panel — the ancestor recipes committed alongside. */
  ancestors: string[];
}

/**
 * RUN a JSON recipe through the renderer: flatten its `extends` chain (composeExtends — identity for a standalone
 * recipe, but the real code path), then resolve every panel to the primitive family it renders through and expand
 * that primitive to its full lineage/root. Undefined when the recipe id is unknown.
 */
export function renderArtifact(id: string): RenderedArtifact | undefined {
  const composed = composeExtends<RawScreenDef>(id, (k) => RECIPE_BY_ID.get(k));
  if (!composed) return undefined;
  const panels = (Array.isArray(composed.panels) ? composed.panels : []) as Array<Record<string, unknown>>;
  const ancestors = new Set<string>();
  const rendered: RenderedPanel[] = panels.map((p) => {
    const kind = String(p["kind"]);
    const primitive = PANEL_PRIMITIVE[kind];
    if (!primitive) return { id: String(p["id"]), kind };
    const resolved = resolvePrimitive(primitive);
    if (!resolved) return { id: String(p["id"]), kind, primitive };
    for (const anc of resolved.lineage) ancestors.add(anc);
    const root = resolved.lineage[resolved.lineage.length - 1] ?? primitive;
    return { id: String(p["id"]), kind, primitive, lineage: resolved.lineage, root };
  });
  const methodologies = Array.isArray(composed["methodologies"]) ? (composed["methodologies"] as unknown[]).map(String) : [];
  return { id: composed.id, label: composed.label, methodologies, panels: rendered, ancestors: [...ancestors].sort() };
}

/**
 * Check a rendered recipe against the CANONICAL STANDARD — a valid screen shape, and every panel resolving through
 * an atom-composable primitive down to its EXPECTED tree root. Returns the list of violations (empty = matches the
 * standard, i.e. safe to commit).
 */
export function canonicalErrors(id: string): string[] {
  const recipe = RECIPE_BY_ID.get(id);
  if (!recipe) return [`unknown recipe "${id}"`];
  const errors: string[] = [];
  if (!recipe.id || typeof recipe.id !== "string") errors.push(`${id}: missing id`);
  if (!recipe.label || typeof recipe.label !== "string") errors.push(`${id}: missing label`);
  const rendered = renderArtifact(id);
  if (!rendered) return [...errors, `${id}: did not render`];
  if (rendered.panels.length === 0) errors.push(`${id}: has no panels`);
  const seenPanelIds = new Set<string>();
  for (const panel of rendered.panels) {
    if (seenPanelIds.has(panel.id)) errors.push(`${id}: duplicate panel id "${panel.id}"`);
    seenPanelIds.add(panel.id);
    if (!panel.primitive) { errors.push(`${id}: panel "${panel.id}" kind "${panel.kind}" is not atom-composable (bespoke escape hatch)`); continue; }
    if (!panel.root) { errors.push(`${id}: panel "${panel.id}" primitive "${panel.primitive}" did not resolve`); continue; }
    // The root must be a real root (no further `extends`) AND the canonically expected one for this family.
    if (getPrimitive(panel.root)?.extends !== undefined) errors.push(`${id}: panel "${panel.id}" root "${panel.root}" is not a tree root`);
    const expected = EXPECTED_ROOT[panel.primitive];
    if (expected && panel.root !== expected) errors.push(`${id}: panel "${panel.id}" (${panel.primitive}) composes to "${panel.root}", expected "${expected}"`);
  }
  return errors;
}

/**
 * The canonical methodology artifact recipes, VERIFIED. Each recipe is rendered and checked against the canonical
 * standard; a recipe that fails THROWS (fail-closed — a non-canonical recipe is a build error, never seeded). The
 * returned array is the set of read-only `screen` defs to commit. A fresh copy each call.
 */
export function methodologyArtifacts(): RawScreenDef[] {
  for (const r of METHODOLOGY_ARTIFACT_RECIPES) {
    const errors = canonicalErrors(r.id);
    if (errors.length) throw new Error(`methodology artifact "${r.id}" is not canonical:\n  - ${errors.join("\n  - ")}`);
  }
  return METHODOLOGY_ARTIFACT_RECIPES.map((r) => ({ ...r }));
}

/**
 * The ancestor primitive recipes committed ALONGSIDE the artifacts — the deduped, sorted set of every primitive id
 * in the transitive lineage of every panel across all artifacts (e.g. chart → geometry-canvas → canvas, register →
 * record-set → record). These are seeded as `primitive` defs (via the primitive catalogue), so a committed screen
 * recipe never references a primitive that isn't also in the store.
 */
export function methodologyArtifactAncestors(): string[] {
  const all = new Set<string>();
  for (const r of METHODOLOGY_ARTIFACT_RECIPES) for (const a of renderArtifact(r.id)?.ancestors ?? []) all.add(a);
  return [...all].sort();
}
