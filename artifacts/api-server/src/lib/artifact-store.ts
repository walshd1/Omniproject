import fs from "node:fs";
import path from "node:path";
import { SealedFile } from "./sealed-file";
import { safeParseJson } from "./safe-json";

/**
 * SCOPED ENCRYPTED-JSON ARTIFACT STORE — the canonical home for user-authored artifacts (whiteboards,
 * wiki pages, …) that OmniProject holds itself rather than in an external system of record.
 *
 * A collection is one SEALED JSON file per (artifact type, SCOPE), under `OMNI_CONFIG_DIR/artifacts/<type>/`:
 *   - `user-<sub>.json`        — a person's PRIVATE area (only they can see it; the caller's own sub is
 *                                always used, so cross-user access is structurally impossible).
 *   - `project-<id>.json`      — shared within one project (the route gates on the caller's project scope).
 *   - `org.json`               — shared org-wide (the route gates on org-write permission).
 *
 * Each file is written atomically + AES-256-GCM sealed at rest (see lib/sealed-file). Zero-at-rest holds:
 * nothing is stored in plaintext, and where no `OMNI_CONFIG_DIR` is configured the store is simply disabled
 * (the routes fall back to the sidecar, or 501). This module owns ONLY the scoped, sealed I/O; callers
 * enforce permission before choosing a scope and sanitise the items before putting them.
 */

export type ArtifactScope =
  | { kind: "user"; sub: string }
  | { kind: "project"; projectId: string }
  // PROGRAMME sits between project and org in the override chain (a project inherits its programme's defs when
  // it belongs to one). Governance-owned (pmo / a programme's manager); one sealed blob per programme.
  | { kind: "programme"; programmeId: string }
  | { kind: "org" }
  // The SYSTEM scope: one encrypted blob holding OUR shipped defaults (default screens/reports/rulesets and the
  // other defs we ship). READ-ONLY to users — it is deliberately NOT a StorageTarget, so the importer/editor can
  // never write it; only the product's own seeder populates it. Renderers read it as the default layer beneath a
  // customer's own defs (which override by id).
  | { kind: "system" };

/** The single read-only system scope (shipped defaults). */
export const SYSTEM_SCOPE: ArtifactScope = { kind: "system" };

/**
 * A STORAGE TARGET — where a user-held artifact (a whiteboard, a wiki page) is saved. The first three map to
 * the scoped encrypted-JSON areas below; `sidecar` means the built-in system-of-record (reached through the
 * broker seam) instead. The author chooses one; the route permission-gates it. Shared so every artifact kind
 * uses the SAME self-describing-id + scope logic (no drift between whiteboards and wiki).
 */
export type StorageTarget = "user" | "project" | "org" | "sidecar";
const STORAGE_TARGETS = new Set<string>(["user", "project", "org", "sidecar"]);
/** Whether a string is a known storage target. */
export function isStorageTarget(s: unknown): s is StorageTarget {
  return typeof s === "string" && STORAGE_TARGETS.has(s);
}

/**
 * Build a SELF-DESCRIBING artifact id that encodes WHERE it lives (`<target>~…~<localId>`), so a later
 * read/write routes to the right store without a lookup. `~` never appears in a uuid or a target word.
 */
export function makeScopedId(storage: StorageTarget, localId: string, projectId?: string): string {
  return storage === "project" ? `project~${projectId}~${localId}` : `${storage}~${localId}`;
}

/** Parse a self-describing id back to its target + parts, or null when malformed. */
export function parseScopedId(id: string): { storage: StorageTarget; projectId?: string; localId: string } | null {
  const parts = id.split("~");
  const storage = parts[0];
  if (storage === "user" || storage === "org" || storage === "sidecar") {
    return parts.length >= 2 ? { storage, localId: parts.slice(1).join("~") } : null;
  }
  if (storage === "project") {
    // project~<projectId>~<localId>; localId is a uuid (no ~), projectId is everything between.
    return parts.length >= 3 ? { storage, projectId: parts.slice(1, -1).join("~"), localId: parts[parts.length - 1]! } : null;
  }
  return null;
}

/**
 * The encrypted-JSON scope for a parsed non-sidecar id. The caller's OWN sub is always used for a `user`
 * artifact, so an id can never address another user's private area (cross-user access is structurally
 * impossible). Returns null for a sidecar id (there is no JSON scope) or a project id missing its projectId.
 */
export function scopeFromParsed(parsed: { storage: StorageTarget; projectId?: string }, sub: string | undefined): ArtifactScope | null {
  if (parsed.storage === "user") return { kind: "user", sub: sub ?? "" };
  if (parsed.storage === "org") return { kind: "org" };
  if (parsed.storage === "project" && parsed.projectId) return { kind: "project", projectId: parsed.projectId };
  return null;
}

/** Max items retained per (type, scope) collection — bounds one sealed file's growth. */
const MAX_PER_COLLECTION = 1000;

/** Filename-safe token (a sub or project id becomes part of a path). */
const UNSAFE = /[^a-zA-Z0-9_.@-]/g;
const safeToken = (s: string): string => s.replace(UNSAFE, "_").slice(0, 200) || "_";

/** The scope's collection filename. */
function scopeFileName(scope: ArtifactScope): string {
  if (scope.kind === "org") return "org.json";
  if (scope.kind === "system") return "system.json";
  if (scope.kind === "user") return `user-${safeToken(scope.sub)}.json`;
  if (scope.kind === "programme") return `programme-${safeToken(scope.programmeId)}.json`;
  return `project-${safeToken(scope.projectId)}.json`;
}

/** The on-disk file for a (type, scope) collection, or null when no OMNI_CONFIG_DIR (store disabled). */
function fileFor(type: string, scope: ArtifactScope): string | null {
  const dir = process.env["OMNI_CONFIG_DIR"]?.trim();
  if (!dir) return null;
  return path.join(dir, "artifacts", safeToken(type), scopeFileName(scope));
}

/** Whether the encrypted-JSON artifact store is available (an OMNI_CONFIG_DIR is configured). */
export function artifactStoreEnabled(): boolean {
  return !!process.env["OMNI_CONFIG_DIR"]?.trim();
}

function readCollection<T>(type: string, scope: ArtifactScope): T[] {
  const f = fileFor(type, scope);
  if (!f) return [];
  const raw = new SealedFile(() => f, `artifact:${type}`).read();
  if (raw === null) return [];
  const parsed = safeParseJson(raw);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function writeCollection<T>(type: string, scope: ArtifactScope, items: T[]): void {
  const f = fileFor(type, scope);
  if (!f) return;
  fs.mkdirSync(path.dirname(f), { recursive: true }); // ensure artifacts/<type>/ exists before the sealed write
  new SealedFile(() => f, `artifact:${type}`).write(JSON.stringify(items.slice(-MAX_PER_COLLECTION)));
}

/** Every item in a (type, scope) collection. */
export function listArtifacts<T extends { id: string }>(type: string, scope: ArtifactScope): T[] {
  return readCollection<T>(type, scope);
}

/** One item by id within a scope, or null. */
export function getArtifact<T extends { id: string }>(type: string, scope: ArtifactScope, id: string): T | null {
  return readCollection<T>(type, scope).find((x) => x.id === id) ?? null;
}

/** Upsert an item into a scope (read-modify-write of the sealed collection). */
export function putArtifact<T extends { id: string }>(type: string, scope: ArtifactScope, item: T): void {
  const items = readCollection<T>(type, scope);
  const idx = items.findIndex((x) => x.id === item.id);
  if (idx >= 0) items[idx] = item;
  else items.push(item);
  writeCollection(type, scope, items);
}

/** Replace an ENTIRE (type, scope) collection in a SINGLE sealed write — one decrypt-free re-encrypt, no
 *  per-item read-modify-write. This is the one-shot update primitive the SYSTEM store uses: build the full
 *  default set, then seal it once. */
export function replaceArtifacts<T extends { id: string }>(type: string, scope: ArtifactScope, items: T[]): void {
  writeCollection(type, scope, items);
}

/** Remove an item from a scope; returns whether it was present. */
export function deleteArtifact(type: string, scope: ArtifactScope, id: string): boolean {
  const items = readCollection<{ id: string }>(type, scope);
  const next = items.filter((x) => x.id !== id);
  if (next.length === items.length) return false;
  writeCollection(type, scope, next);
  return true;
}

/** Reconstruct a scope from a collection filename (the inverse of `scopeFileName`), or null if unrecognised.
 *  NOTE: `user`/`project` tokens are filename-safe, so a scope with special characters in its id is
 *  approximate — good enough to READ the collection back for a portfolio sweep, not to reconstruct the sub. */
function scopeFromFileName(name: string): ArtifactScope | null {
  if (name === "org.json") return { kind: "org" };
  if (name === "system.json") return { kind: "system" };
  const user = name.match(/^user-(.+)\.json$/);
  if (user) return { kind: "user", sub: user[1]! };
  const programme = name.match(/^programme-(.+)\.json$/);
  if (programme) return { kind: "programme", programmeId: programme[1]! };
  const project = name.match(/^project-(.+)\.json$/);
  if (project) return { kind: "project", projectId: project[1]! };
  return null;
}

/**
 * Every collection of a type across ALL scopes — for portfolio-wide sweeps (e.g. the goal check-in cadence).
 * Scans `OMNI_CONFIG_DIR/artifacts/<type>/`, reads + decrypts each sealed file, and returns each as
 * `{ scope, items }`. Empty when the store is disabled. Items carry their own authoritative fields (owner,
 * etc.), so a caller that needs the true owner should read it off the item, not the (approximate) scope.
 */
export function listAllArtifactCollections<T extends { id: string }>(type: string): { scope: ArtifactScope; items: T[] }[] {
  const dir = process.env["OMNI_CONFIG_DIR"]?.trim();
  if (!dir) return [];
  const typeDir = path.join(dir, "artifacts", safeToken(type));
  let names: string[];
  try { names = fs.readdirSync(typeDir); } catch { return []; }
  const out: { scope: ArtifactScope; items: T[] }[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const scope = scopeFromFileName(name);
    if (!scope) continue;
    const items = readCollection<T>(type, scope);
    if (items.length) out.push({ scope, items });
  }
  return out;
}
