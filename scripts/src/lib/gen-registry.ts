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
import { fileURLToPath } from "node:url";
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
  /** The property that identifies each asset and must equal its filename. Defaults to "id"; widgets
   *  key on "type". */
  idField?: string;
}

/** Read, validate (schema + filename===id + unique) and id-sort one group. Throws on any violation. */
export function loadGroup(group: AssetGroup): Array<{ id: string }> {
  const idField = group.idField ?? "id";
  const files = fs.readdirSync(group.dir).filter((f) => f.endsWith(".json")).sort();
  const rows: Array<{ id: string }> = [];
  const seen = new Set<string>();
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(group.dir, file), "utf8")) as Record<string, unknown>;
    const errs = validate(group.schema, data);
    if (errs.length) throw new Error(`${group.label}/${file} fails its schema:\n  - ${errs.join("\n  - ")}`);
    const idVal = data[idField];
    if (idVal !== file.replace(/\.json$/, "")) throw new Error(`${group.label}/${file}: filename must equal ${idField} "${String(idVal)}"`);
    if (seen.has(idVal as string)) throw new Error(`${group.label}: duplicate ${idField} "${String(idVal)}"`);
    seen.add(idVal as string);
    rows.push(data as unknown as { id: string });
  }
  return rows.sort((a, b) => String((a as unknown as Record<string, unknown>)[idField]).localeCompare(String((b as unknown as Record<string, unknown>)[idField])));
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

/** Repo root, resolved from this module's fixed location (scripts/src/lib/). */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Config for a single-group asset generator (the gen-views / gen-widgets / … family). */
export interface SingleAssetGeneratorOptions {
  /** Asset subdirectory under lib/backend-catalogue/assets; also the `<label>.generated.ts` basename via `label`. */
  dir: string;
  /** Schema filename under assets/schema, e.g. "view.schema.json". */
  schemaFile: string;
  /** Error-message + console label (e.g. "views"); also the `gen-<label>` script/alias name. */
  label: string;
  /** The exported const name in the generated module. */
  constName: string;
  /** The element type + the module it is imported from. */
  typeName: string;
  typeModule: string;
  /** The property that identifies each asset and must equal its filename. Defaults to "id". */
  idField?: string;
  /** The capitalised plural noun used in the generated-module header comment (e.g. "Views", "Presets"). */
  noun: string;
}

/**
 * Run one single-group JSON-asset generator end-to-end: resolve the asset paths, read + validate the
 * group, emit its `lib/backend-catalogue/src/<label>.generated.ts`, and log the summary. Each gen-views /
 * gen-widgets / … script is now a single call to this — the setup/read/emit/log that used to be inlined
 * (byte-for-byte) in every one of them.
 */
export function runSingleAssetGenerator(opts: SingleAssetGeneratorOptions): void {
  const assets = path.join(REPO_ROOT, "lib/backend-catalogue/assets");
  const outTs = path.join(REPO_ROOT, `lib/backend-catalogue/src/${opts.label}.generated.ts`);

  const group: AssetGroup = {
    dir: path.join(assets, opts.dir),
    schema: JSON.parse(fs.readFileSync(path.join(assets, "schema", opts.schemaFile), "utf8")) as JsonSchema,
    label: opts.label,
    constName: opts.constName,
    typeName: opts.typeName,
    typeModule: opts.typeModule,
    ...(opts.idField ? { idField: opts.idField } : {}),
  };

  const rows = loadGroup(group);
  emitRegistry(outTs, [
    `/* GENERATED by scripts/src/gen-${opts.label}.ts — do not edit.`,
    `   ${opts.noun} are authored as JSON under lib/backend-catalogue/assets/${opts.dir}/;`,
    `   run \`pnpm --filter @workspace/scripts run gen-${opts.label}\` to regenerate. */`,
  ], [{ group, rows }]);

  console.log(`${opts.label}: ${rows.length} validated`);
  console.log(`  → ${path.relative(REPO_ROOT, outTs)}`);
}
