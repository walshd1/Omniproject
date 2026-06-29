import fs from "node:fs";
import path from "node:path";

/**
 * The canonical field superset = the base vocabulary (assets/fields.json) UNION every field a
 * backend descriptor CONTRIBUTES (its optional `fields[]`). This is the single place that
 * computes that union, shared by `gen-fields` (which emits it) and `guard-superset` (which checks
 * every backend's field references are a subset of it) — so the two can never disagree.
 */

export interface FieldRow {
  key: string;
  type?: string;
  group?: string;
  [k: string]: unknown;
}

const backendsDir = (root: string) => path.join(root, "lib/backend-catalogue/vendors/backends");

/** Read every backend descriptor JSON: `[{ id, fields?, fieldKeys?, ... }]`. */
function readBackends(root: string): Array<{ file: string; fields: FieldRow[] | undefined; fieldKeys: string[] | undefined }> {
  const dir = backendsDir(root);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((file) => {
      const def = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { fields?: FieldRow[]; fieldKeys?: string[] };
      return { file, fields: def.fields, fieldKeys: def.fieldKeys };
    });
}

/**
 * The merged superset: base fields first, then each backend's contributed `fields[]`. Dedup by
 * key (first definition wins); a later definition of the same key with a CONFLICTING type/group
 * is a hard error (two backends can't disagree on what a canonical field means).
 */
export function loadSuperset(root: string): { fields: FieldRow[]; keys: Set<string> } {
  const base = JSON.parse(fs.readFileSync(path.join(root, "lib/backend-catalogue/assets/fields.json"), "utf8")) as FieldRow[];
  if (!Array.isArray(base)) throw new Error("fields.json must be a JSON array");

  const byKey = new Map<string, FieldRow>();
  const out: FieldRow[] = [];
  const add = (f: FieldRow, src: string) => {
    const existing = byKey.get(f.key);
    if (existing) {
      if (existing.type !== f.type || existing.group !== f.group) {
        throw new Error(
          `field "${f.key}" is redefined with a conflicting type/group by ${src} ` +
            `(existing: ${existing.type}/${existing.group ?? "—"}, new: ${f.type}/${f.group ?? "—"})`,
        );
      }
      return; // dedup — first definition wins
    }
    byKey.set(f.key, f);
    out.push(f);
  };

  base.forEach((f) => add(f, "fields.json"));
  for (const b of readBackends(root)) {
    if (Array.isArray(b.fields)) b.fields.forEach((f) => add(f, `backends/${b.file}`));
  }
  return { fields: out, keys: new Set(byKey.keys()) };
}

/** The canonical field keys each backend REFERENCES (its `fieldKeys[]`), per file. */
export function backendFieldRefs(root: string): Array<{ file: string; keys: string[] }> {
  return readBackends(root).map((b) => ({ file: b.file, keys: Array.isArray(b.fieldKeys) ? b.fieldKeys : [] }));
}
