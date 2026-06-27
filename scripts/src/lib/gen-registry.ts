/**
 * Generic JSON-asset registry generator.
 *
 * The shared engine behind gen-vendors and gen-views (and any future asset
 * plane): read a directory of per-asset JSON files, validate each against its
 * schema (+ filename===id + unique id), id-sort, and emit a portable,
 * type-checked `*.generated.ts` module of typed arrays. One engine, a registry of
 * group descriptors — the same generic-with-options shape the catalogue uses.
 */
import fs from "node:fs";
import path from "node:path";
import { validate, type JsonSchema } from "../../../lib/backend-catalogue/src/vendor-schema";

/** One asset group: a JSON directory + the schema + how it lands in the module. */
export interface AssetGroup {
  /** Absolute directory holding the per-asset `<id>.json` files. */
  dir: string;
  /** The JSON Schema every file in `dir` is validated against. */
  schema: JsonSchema;
  /** A label used in error messages (e.g. the plane name). */
  label: string;
  /** The exported const name in the generated module. */
  constName: string;
  /** The element type + the module it is imported from. */
  typeName: string;
  typeModule: string;
}

/** Read, validate (schema + filename===id + unique) and id-sort one group. Throws on any violation. */
export function loadGroup(group: AssetGroup): Array<{ id: string }> {
  const files = fs.readdirSync(group.dir).filter((f) => f.endsWith(".json")).sort();
  const rows: Array<{ id: string }> = [];
  const seen = new Set<string>();
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(group.dir, file), "utf8")) as { id?: string };
    const errs = validate(group.schema, data);
    if (errs.length) throw new Error(`${group.label}/${file} fails its schema:\n  - ${errs.join("\n  - ")}`);
    if (data.id !== file.replace(/\.json$/, "")) throw new Error(`${group.label}/${file}: filename must equal id "${data.id}"`);
    if (seen.has(data.id)) throw new Error(`${group.label}: duplicate id "${data.id}"`);
    seen.add(data.id);
    rows.push(data as { id: string });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

/** Emit a generated module: the header comment, the type imports, then one const per group. */
export function emitRegistry(
  outFile: string,
  headerLines: string[],
  loaded: Array<{ group: AssetGroup; rows: Array<{ id: string }> }>,
): void {
  const lines: string[] = [...headerLines];
  for (const { group } of loaded) lines.push(`import type { ${group.typeName} } from "${group.typeModule}";`);
  lines.push("");
  for (const { group, rows } of loaded) {
    lines.push(`export const ${group.constName}: ${group.typeName}[] = ${JSON.stringify(rows, null, 2)};`);
    lines.push("");
  }
  fs.writeFileSync(outFile, lines.join("\n"));
}
