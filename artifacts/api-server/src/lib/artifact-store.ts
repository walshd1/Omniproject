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
  | { kind: "org" };

/** Max items retained per (type, scope) collection — bounds one sealed file's growth. */
const MAX_PER_COLLECTION = 1000;

/** Filename-safe token (a sub or project id becomes part of a path). */
const UNSAFE = /[^a-zA-Z0-9_.@-]/g;
const safeToken = (s: string): string => s.replace(UNSAFE, "_").slice(0, 200) || "_";

/** The scope's collection filename. */
function scopeFileName(scope: ArtifactScope): string {
  if (scope.kind === "org") return "org.json";
  if (scope.kind === "user") return `user-${safeToken(scope.sub)}.json`;
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

/** Remove an item from a scope; returns whether it was present. */
export function deleteArtifact(type: string, scope: ArtifactScope, id: string): boolean {
  const items = readCollection<{ id: string }>(type, scope);
  const next = items.filter((x) => x.id !== id);
  if (next.length === items.length) return false;
  writeCollection(type, scope, next);
  return true;
}
