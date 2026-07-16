/**
 * PUBLISHED REFERENCE DESIGNS loader (roadmap 3.5, slice 2). The reference designs are NOT authored in code
 * — they are plain JSON files committed in the repo under `reference-designs/`, outside the running system,
 * so anyone can read, copy and adapt them (add one by dropping in a `.json` file, nothing to compile). This
 * module is only a thin, cached loader: it reads those files from disk and exposes them read-only. The files
 * are the source of truth; `registry-reference.test` reads the same files and holds every example to the
 * real submit sanitiser + def validators, so a published reference can never drift into an invalid shape.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RegistryItemKind } from "@workspace/backend-catalogue";

/** A published reference design — the parsed content of one `reference-designs/**\/*.json` file. */
export interface ReferenceDesign {
  /** Stable slug (URL + lookup key), derived from the file name. */
  slug: string;
  /** Human title. */
  title: string;
  /** The registry item kind this reference teaches (from the example). */
  kind: RegistryItemKind;
  /** One-line "what you'll learn". */
  summary: string;
  /** Field-by-field annotations explaining the shape. */
  notes: string[];
  /** A complete, valid registry submission — paste into POST /api/registry as-is. */
  example: {
    kind: RegistryItemKind;
    name: string;
    publisher: string;
    version: string;
    description: string;
    tags: string[];
    payload: Record<string, unknown>;
  };
}

/** Walk up from a starting dir to the repo root (the dir holding `pnpm-workspace.yaml`), or null. */
function findRepoRoot(from: string): string | null {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The repo `reference-designs/` directory, or null when it can't be located (e.g. a trimmed deploy). */
export function referenceDesignsDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = findRepoRoot(here);
  if (!root) return null;
  const dir = path.join(root, "reference-designs");
  return fs.existsSync(dir) ? dir : null;
}

/** Every `.json` file under a dir (one level of subfolders), sorted for a stable order. */
function jsonFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsonFilesUnder(full));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

/** Slug from a file name: `grouped-column.primitive.json` → `grouped-column`. */
function slugFromFile(file: string): string {
  return path.basename(file).replace(/\.json$/, "").replace(/\.[^.]+$/, "");
}

let cache: ReferenceDesign[] | null = null;

/** Load (and cache) the reference designs from the repo files. Returns [] when the directory is absent. */
export function loadReferenceDesigns(): ReferenceDesign[] {
  if (cache) return cache;
  const dir = referenceDesignsDir();
  if (!dir) return (cache = []);
  const designs: ReferenceDesign[] = [];
  for (const file of jsonFilesUnder(dir)) {
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { continue; } // a malformed file is skipped rather than crashing the endpoint; the test catches it.
    const o = (parsed ?? {}) as Record<string, unknown>;
    const example = o["example"] as ReferenceDesign["example"] | undefined;
    if (!example || typeof example !== "object" || typeof example.kind !== "string") continue;
    designs.push({
      slug: slugFromFile(file),
      title: typeof o["title"] === "string" ? o["title"] : example.name,
      kind: example.kind,
      summary: typeof o["summary"] === "string" ? o["summary"] : (example.description ?? ""),
      notes: Array.isArray(o["notes"]) ? (o["notes"] as unknown[]).filter((n): n is string => typeof n === "string") : [],
      example,
    });
  }
  return (cache = designs);
}

/** Drop the cache (test seam / after files change on disk). */
export function resetReferenceDesigns(): void { cache = null; }

/** One reference design by slug, or null. */
export function referenceDesign(slug: string): ReferenceDesign | null {
  return loadReferenceDesigns().find((d) => d.slug === slug) ?? null;
}

/** The reference designs that teach a given registry item kind. */
export function referenceDesignsForKind(kind: RegistryItemKind): ReferenceDesign[] {
  return loadReferenceDesigns().filter((d) => d.kind === kind);
}
