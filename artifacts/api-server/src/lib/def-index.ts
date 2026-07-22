import { getArtifact, replaceArtifacts, deleteArtifact, SYSTEM_SCOPE } from "./artifact-store";
import type { StoredDef } from "./def-import";

/**
 * THE DEF CHILD-EDGE INDEX — a small, sealed acceleration for the composition integrity checks. It records, per
 * kind, which logical ids EXTEND each parent id (`parentId → [childId]`), so the importer can answer one cheap
 * question without decrypting the whole def store: "does anything extend this def?".
 *
 * Why it exists: a def that is ROOTLESS (no `extends`) and that NOTHING extends can neither need ancestors nor
 * cascade into descendants — so its integrity check is just "validate itself against the shipped catalogue".
 * That is the COMMON case (most defs are standalone), and this index lets it skip the deployment-wide decrypt
 * (`collectDefCollections`), which otherwise reads + AES-decrypts every sealed collection — including every
 * user's accessibility leaf — on every write.
 *
 * SAFETY (rebuild-on-doubt): correctness never depends on the index being fresh. It is only ever consulted to
 * take the FAST PATH, and it is built to only ever OVER-report children (forcing the safe full scan), never
 * under-report:
 *   - It is ADDITIVE write-through (`defIndexAddEdge` only adds an edge, never removes), so a rename/delete can
 *     leave a stale edge → over-report → full path → correct.
 *   - Any write-through failure INVALIDATES the whole index (the caller deletes it), forcing a clean rebuild.
 *   - It is INVALIDATED on boot and on a shipped-defaults reseed, so a crash mid-write can't strand a stale
 *     index across a restart.
 *   - When absent/stale-schema it is rebuilt from the authoritative full scan (`ensureDefIndex`).
 * The only way to WRONGLY take the fast path is a genuine under-report, which the above make impossible in
 * practice; if you are ever unsure, delete the file and it rebuilds.
 */

const INDEX_TYPE = "def-index";
const INDEX_ID = "index";
const SCHEMA = 1;

interface DefIndex {
  id: string;
  schema: number;
  /** kind → parentLogicalId → the logical ids that extend it. */
  children: Record<string, Record<string, string[]>>;
}

const emptyIndex = (): DefIndex => ({ id: INDEX_ID, schema: SCHEMA, children: {} });

/** Read the persisted index, or null when absent / a stale schema (→ the caller rebuilds from a full scan). */
export function readDefIndex(): DefIndex | null {
  const ix = getArtifact<DefIndex>(INDEX_TYPE, SYSTEM_SCOPE, INDEX_ID);
  return ix && ix.schema === SCHEMA && ix.children && typeof ix.children === "object" ? ix : null;
}

function writeDefIndex(ix: DefIndex): void { replaceArtifacts(INDEX_TYPE, SYSTEM_SCOPE, [ix]); }

/** Rebuild-on-doubt: drop the index so the next read rebuilds it from the authoritative full scan. */
export function invalidateDefIndex(): void {
  try { deleteArtifact(INDEX_TYPE, SYSTEM_SCOPE, INDEX_ID); } catch { /* best effort */ }
}

const logicalId = (d: StoredDef): string => (typeof (d.payload as { id?: unknown })?.id === "string" ? String((d.payload as { id: string }).id) : "");
const extendsOf = (d: StoredDef): string => (typeof (d.payload as { extends?: unknown })?.extends === "string" ? String((d.payload as { extends: string }).extends) : "");

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * A logical id / `extends` ref is UNTRUSTED (a def author picks it; the importer only checks it is a non-empty
 * string). An Object.prototype member name (`__proto__`, `constructor`, `toString`, `valueOf`, …) can't be a
 * safe plain-object dictionary key: reading `byParent[key]` returns the INHERITED member (so the `.includes` /
 * `.push` array ops below throw a TypeError), and assigning `byParent["__proto__"] = …` mutates the prototype
 * instead of storing an edge. Such an id is pathological; we NEVER index it as a parent key and NEVER fast-path
 * it — `defHasChildren` OVER-reports (returns true, forcing the authoritative full scan), so the never-under-report
 * safety invariant holds without a prototype key ever being touched. (`kind` is a fixed allow-list, so it needs
 * no such guard.)
 */
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const isUnsafeKey = (k: string): boolean => RESERVED_KEYS.has(k) || hasOwn(Object.prototype, k);

/** Build the index from the FULL set of stored def collections (the authoritative source of every edge). */
export function buildDefIndex(collections: { items: StoredDef[] }[]): DefIndex {
  const ix = emptyIndex();
  for (const { items } of collections) {
    for (const d of items) {
      const child = logicalId(d);
      const parent = extendsOf(d);
      if (!child || !parent || isUnsafeKey(parent)) continue; // reserved parent → never indexed (full scan covers it)
      const byParent = (ix.children[d.kind] ??= {});
      const arr = (byParent[parent] ??= []);
      if (!arr.includes(child)) arr.push(child);
    }
  }
  return ix;
}

/** Ensure a fresh index exists, rebuilding + persisting from `collections` when absent/stale. Returns it. Called
 *  on the FULL path (which has already decrypted `collections` anyway), so the next inert write hits the fast
 *  path for free. */
export function ensureDefIndex(collections: { items: StoredDef[] }[]): DefIndex {
  const existing = readDefIndex();
  if (existing) return existing;
  const built = buildDefIndex(collections);
  try { writeDefIndex(built); } catch { /* store may be unavailable; the in-memory copy still answers this call */ }
  return built;
}

/** Does ANY stored def of `kind` extend `parentId`? Over-reporting is safe (forces the full path); never
 *  under-reports (every edge is added write-through, and a boot/reseed rebuild reconciles). */
export function defHasChildren(ix: DefIndex, kind: string, parentId: string): boolean {
  if (isUnsafeKey(parentId)) return true; // never fast-path a reserved id — force the safe full scan
  const byParent = ix.children[kind];
  const arr = byParent && hasOwn(byParent, parentId) ? byParent[parentId] : undefined;
  return Array.isArray(arr) && arr.length > 0;
}

/** Write-through: record that `childId` (of `kind`) extends `parentId`. Additive + idempotent — it can only
 *  ever OVER-report children, which is safe. On ANY failure the caller invalidates the whole index. */
export function defIndexAddEdge(kind: string, childId: string, parentId: string): void {
  if (!childId || !parentId || isUnsafeKey(parentId)) return; // reserved parent → never indexed (full scan covers it)
  const ix = readDefIndex();
  if (!ix) return; // absent → a later ensureDefIndex rebuilds from scan; nothing to keep current
  const byParent = (ix.children[kind] ??= {});
  const arr = (byParent[parentId] ??= []);
  if (!arr.includes(childId)) { arr.push(childId); writeDefIndex(ix); }
}
