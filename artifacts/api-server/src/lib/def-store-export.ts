import {
  listAllArtifactCollections, replaceArtifacts, artifactStoreEnabled, type ArtifactScope,
} from "./artifact-store";
import { DEF_ARTIFACT, validateDef, DEF_KINDS, isVendorControlledKind, type StoredDef, type DefKind } from "./def-import";
import { BINDING_ARTIFACT } from "./def-binding";
import { EXTENSION_ARTIFACT, isImportableExtension } from "./extension";
import { REGISTRY_ARTIFACT, isImportableRegistryItem } from "./registry";

/**
 * DEF-STORE export / import (roadmap X.14) — the portable backup of everything an admin AUTHORS into the
 * scoped encrypted stores: imported defs, selection bindings + locks, the def-write policy, and custom RBAC
 * roles. The settings snapshot (`config-snapshot`) never covered these, so a backup silently lost them.
 *
 * Security model, end to end:
 *  - EXPORT decrypts each sealed collection into a portable plaintext bundle. The deployment's encryption KEY
 *    never leaves — the operator secures the file. Admin-gated + step-up + audited at the route.
 *  - IMPORT is the ONLY writer back in (the X.10 choke-point rule): every def is RE-VALIDATED by its per-kind
 *    validator (a tampered/injected payload is dropped, not written), config blobs must be `{id}` objects, the
 *    read-only SYSTEM scope is refused, and each collection is RE-ENCRYPTED under the TARGET instance's own key
 *    via `replaceArtifacts`. So a bundle can move between instances (or survive a full code replacement +
 *    redeploy) and be reimported without ever transporting a key or bypassing validation.
 *
 * Pure-ish: reads/writes go through the artifact store, but the validation + shaping is deterministic + tested.
 */

export const DEF_STORE_EXPORT_SCHEMA = "omniproject/def-store-export";
export const DEF_STORE_EXPORT_VERSION = 1;

/** The customer-authored encrypted stores to back up. The `def` store's SYSTEM scope is deliberately EXCLUDED
 *  (our shipped catalogues re-seed from code on the new instance); everything else is org/programme/project/
 *  user config. `def-policy` + `custom-roles` are single-row org config blobs; `def-binding` is per-scope maps;
 *  `user-prefs` is the per-user UI/accessibility row that moved out of the settings blob into each user's own
 *  vault (roadmap X.10) — carrying it here is what lets a backup/restore genuinely round-trip a person's setup;
 *  `extension` + `registry-item` are the org-wide plugin/registry config (pure-JSON, no code), folded in so the
 *  backup is the org's TOTAL config. */
const EXPORT_TYPES = [DEF_ARTIFACT, BINDING_ARTIFACT, "def-policy", "custom-roles", "user-prefs", EXTENSION_ARTIFACT, REGISTRY_ARTIFACT] as const;

/** Per-type re-validators for the config-blob stores that carry a richer payload than a bare `{id}` map. On
 *  import a row that fails its validator is DROPPED, not written — the "importer re-validates" rule extended to
 *  extensions (each contribution re-sanitised) and registry items (kind + JSON payload). Types absent here fall
 *  back to the `{id}`-object shape gate (def-policy, custom-roles, def-binding, user-prefs). */
const CONFIG_VALIDATORS: Record<string, (row: unknown) => boolean> = {
  [EXTENSION_ARTIFACT]: isImportableExtension,
  [REGISTRY_ARTIFACT]: isImportableRegistryItem,
};

type Row = { id: string } & Record<string, unknown>;
export interface ExportCollection { type: string; scope: ArtifactScope; items: Row[] }
export interface DefStoreExport {
  schema: typeof DEF_STORE_EXPORT_SCHEMA;
  version: number;
  createdAt: string;
  collections: ExportCollection[];
}

export class DefStoreImportError extends Error {
  constructor(message: string) { super(message); this.name = "DefStoreImportError"; }
}

/** Capture every customer-authored def-store collection as a portable bundle (system scope excluded). Empty
 *  `collections` when the store is disabled. `now` is passed in so the result is deterministic for tests. */
export function buildDefStoreExport(now: string): DefStoreExport {
  const collections: ExportCollection[] = [];
  if (artifactStoreEnabled()) {
    for (const type of EXPORT_TYPES) {
      for (const { scope, items } of listAllArtifactCollections<Row>(type)) {
        if (scope.kind === "system") continue; // shipped catalogues re-seed from code, never travel in a customer backup
        if (items.length) collections.push({ type, scope, items });
      }
    }
  }
  return { schema: DEF_STORE_EXPORT_SCHEMA, version: DEF_STORE_EXPORT_VERSION, createdAt: now, collections };
}

export interface ApplyReport {
  written: { type: string; scope: ArtifactScope; count: number }[];
  warnings: string[];
  /** How many individual items were dropped (invalid def payload, non-object row, or system scope). */
  skipped: number;
}

/** Reconstruct + sanity-check a scope from the bundle (the inverse of what the export serialised). Returns a
 *  clean ArtifactScope or null. `system` is returned as-is so the caller can explicitly REFUSE it. */
function cleanScope(raw: unknown): ArtifactScope | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  switch (s["kind"]) {
    case "org": return { kind: "org" };
    case "system": return { kind: "system" };
    case "user": { const sub = str(s["sub"]); return sub ? { kind: "user", sub } : null; }
    case "project": { const id = str(s["projectId"]); return id ? { kind: "project", projectId: id } : null; }
    case "programme": { const id = str(s["programmeId"]); return id ? { kind: "programme", programmeId: id } : null; }
    default: return null;
  }
}

function describeScope(s: ArtifactScope): string {
  if (s.kind === "user") return `user:${s.sub}`;
  if (s.kind === "project") return `project:${s.projectId}`;
  if (s.kind === "programme") return `programme:${s.programmeId}`;
  return s.kind;
}

/** Re-validate an exported def ROW: it must carry a known kind, a string id/name, and a payload that still
 *  passes its per-kind validator (this is the security check — a tampered payload is dropped). Timestamps /
 *  rowVersion are defaulted if the bundle omitted them. Returns null to drop the row. */
function cleanDef(raw: unknown): StoredDef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r["id"] === "string" ? r["id"] : "";
  const kind = r["kind"];
  const name = typeof r["name"] === "string" ? r["name"] : "";
  if (!id || !name || typeof kind !== "string" || !(DEF_KINDS as readonly string[]).includes(kind)) return null;
  if (!validateDef(kind as DefKind, r["payload"]).ok) return null;
  return {
    id, kind: kind as DefKind, name, payload: r["payload"],
    createdBy: typeof r["createdBy"] === "string" ? r["createdBy"] : null,
    createdAt: typeof r["createdAt"] === "string" ? r["createdAt"] : "",
    updatedAt: typeof r["updatedAt"] === "string" ? r["updatedAt"] : "",
    rowVersion: typeof r["rowVersion"] === "number" ? r["rowVersion"] : 1,
  };
}

/**
 * Validate a def-store export bundle and WRITE it back into the (target instance's) encrypted stores. The ONLY
 * writer, so every rule is enforced here: unknown schema throws; the system scope is refused; defs are
 * re-validated per kind; config blobs must be `{id}` objects; each collection is written via `replaceArtifacts`
 * (re-encrypting under this instance's key). Returns a per-collection report + warnings + a dropped-item count.
 */
export function applyDefStoreExport(input: unknown): ApplyReport {
  if (!artifactStoreEnabled()) throw new DefStoreImportError("no encrypted-JSON store is configured on this deployment");
  if (!input || typeof input !== "object") throw new DefStoreImportError("export must be a JSON object");
  const bundle = input as Partial<DefStoreExport>;
  if (bundle.schema !== DEF_STORE_EXPORT_SCHEMA) throw new DefStoreImportError(`unrecognised export schema: ${String(bundle.schema)}`);

  const warnings: string[] = [];
  if (bundle.version !== DEF_STORE_EXPORT_VERSION) warnings.push(`export version ${String(bundle.version)} differs from ${DEF_STORE_EXPORT_VERSION}; applying best-effort`);
  const collections = Array.isArray(bundle.collections) ? bundle.collections : [];

  const written: ApplyReport["written"] = [];
  let skipped = 0;
  for (const col of collections) {
    if (!col || typeof col !== "object") { warnings.push("skipped a malformed collection"); continue; }
    const type = typeof (col as ExportCollection).type === "string" ? (col as ExportCollection).type : "";
    if (!(EXPORT_TYPES as readonly string[]).includes(type)) { warnings.push(`skipped unknown store type "${type}"`); continue; }
    const scope = cleanScope((col as ExportCollection).scope);
    if (!scope) { warnings.push("skipped a collection with an unrecognised scope"); continue; }
    if (scope.kind === "system") {
      const n = Array.isArray((col as ExportCollection).items) ? (col as ExportCollection).items.length : 0;
      warnings.push("refused to import into the read-only system scope (it re-seeds from code)");
      skipped += n;
      continue;
    }
    const rawItems = Array.isArray((col as ExportCollection).items) ? (col as ExportCollection).items : [];

    if (type === DEF_ARTIFACT) {
      const clean: StoredDef[] = [];
      for (const it of rawItems) {
        const def = cleanDef(it);
        // Vendor-controlled kinds (primitives) can never live at a customer scope — drop any that a backup carries
        // (e.g. from before the lockdown) rather than re-introducing a fork on migration.
        if (def && !isVendorControlledKind(def.kind)) clean.push(def); else { skipped++; }
      }
      if (clean.length < rawItems.length) warnings.push(`dropped ${rawItems.length - clean.length} invalid or vendor-controlled def(s) in ${describeScope(scope)}`);
      replaceArtifacts(DEF_ARTIFACT, scope, clean);
      written.push({ type, scope, count: clean.length });
    } else {
      // Config blobs (def-binding maps, def-policy, custom-roles, user-prefs, extension, registry-item): each
      // row must be an `{id}` object, and — for types with a per-type validator (extension, registry-item) — it
      // must also pass that validator (a tampered/injected row is dropped, not written). Types without one rely
      // on the shape gate + the store's own read-time validators.
      const validate = CONFIG_VALIDATORS[type];
      const clean = rawItems.filter((it): it is Row =>
        !!it && typeof it === "object" && typeof (it as Row).id === "string" && (!validate || validate(it)));
      if (clean.length < rawItems.length) { skipped += rawItems.length - clean.length; warnings.push(`dropped ${rawItems.length - clean.length} malformed ${type} row(s) in ${describeScope(scope)}`); }
      replaceArtifacts(type, scope, clean);
      written.push({ type, scope, count: clean.length });
    }
  }
  return { written, warnings, skipped };
}
