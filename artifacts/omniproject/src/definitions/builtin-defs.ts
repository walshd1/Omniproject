/**
 * Baseline (shipped) artifact definitions — the read-only reports/views/charts OmniProject ships out of
 * the box. They live as enumerable JSON files under `builtin/artifacts/`, so a new baseline artifact is
 * added by dropping a `.json` file into the folder — no code change. The set is loaded *statelessly* at
 * runtime from those shipped files; it is deliberately NOT written into the deployment's config store.
 *
 * This keeps the baseline strictly separate from a user/org's own customisations (which do live, encrypted,
 * in the store): the shipped defs are the same on every deployment and never travel in a settings export,
 * so a customer's backup contains only what they authored. `builtin: true` marks every entry read-only.
 */
export type BuiltinArtifactKind = "report" | "view" | "chart";

export interface BuiltinArtifactDef {
  id: string;
  kind: BuiltinArtifactKind;
  label: string;
  /** Always true — baseline defs are read-only. Set by the loader regardless of the file's value. */
  builtin: true;
  /** The kind-specific definition body (a SavedView / CustomReportDef / chart spec), validated at use. */
  spec: Record<string, unknown>;
  /** Methodology ids this artifact belongs to — so a methodology pack can ship its own artifact defs and
   *  they collect with the pack (mirrors the backend catalogue's methodology tags). Absent/empty = neutral
   *  (ships regardless of the active methodology). */
  methodologies?: string[];
}

const KINDS = new Set<BuiltinArtifactKind>(["report", "view", "chart"]);

function isValid(value: unknown): value is Omit<BuiltinArtifactDef, "builtin"> {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  const methodologiesOk = o["methodologies"] == null
    || (Array.isArray(o["methodologies"]) && o["methodologies"].every((m) => typeof m === "string"));
  return typeof o["id"] === "string" && o["id"].length > 0
    && typeof o["label"] === "string" && o["label"].length > 0
    && KINDS.has(o["kind"] as BuiltinArtifactKind)
    && !!o["spec"] && typeof o["spec"] === "object"
    && methodologiesOk;
}

/**
 * Turn a map of enumerated JSON modules (path → parsed default) into the validated, de-duplicated,
 * id-sorted baseline set. Invalid or duplicate entries are skipped (first id wins) so one malformed
 * drop-in file can't break the shipped catalogue. Pure — the caller supplies the modules (via
 * `import.meta.glob` at runtime, or a literal map in tests).
 */
export function parseBuiltinArtifacts(modules: Record<string, unknown>): BuiltinArtifactDef[] {
  const byId = new Map<string, BuiltinArtifactDef>();
  for (const raw of Object.values(modules)) {
    if (!isValid(raw)) continue;
    const def: BuiltinArtifactDef = { id: raw.id, kind: raw.kind, label: raw.label, builtin: true, spec: raw.spec };
    if (raw.methodologies && raw.methodologies.length) def.methodologies = raw.methodologies;
    if (!byId.has(def.id)) byId.set(def.id, def);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Baseline artifacts that belong to a methodology — its own tag, or neutral (untagged) artifacts that
 *  ship regardless. Lets a methodology pack's shipped artifact defs collect with the pack. */
export function artifactsForMethodology(defs: readonly BuiltinArtifactDef[], methodology: string): BuiltinArtifactDef[] {
  return defs.filter((d) => !d.methodologies || d.methodologies.length === 0 || d.methodologies.includes(methodology));
}
