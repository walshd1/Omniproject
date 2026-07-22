/**
 * PLUGIN MARKETPLACE server logic (roadmap 3.4) — the authoritative sanitiser + storage access for installed
 * EXTENSIONS. An extension is a JSON manifest carrying typed CONTRIBUTION PRIMITIVES (report / contentPage /
 * dashboard / screen — the `extensionContribution` family), each a pure-JSON config artefact the app already
 * renders; NO extension ships executable code, so installing one is a governance decision, not a deploy.
 * Extensions are ORG-WIDE config, held in the sealed artifact store (org scope). `sanitizeExtensionInstall`
 * is the single choke point every install passes through; identity + timestamps are stamped server-side.
 */
import type { ActorContext } from "../broker/types";
import { listArtifacts, getArtifact, putArtifact, deleteArtifact, type ArtifactScope } from "./artifact-store";
import { sanitizeText as cleanText } from "./coerce";
import { actorLabel } from "./actor";
import { EXTENSION_CONTRIBUTION_KINDS, type ExtensionContributionKind, type ExtensionStatus } from "@workspace/backend-catalogue";

/** A rejected extension install (maps to 400). */
export class ExtensionError extends Error {
  constructor(message: string) { super(message); this.name = "ExtensionError"; }
}

/** The artifact-store type key for installed extensions. */
export const EXTENSION_ARTIFACT = "extension";

/** Extensions are always org-wide config. */
export const EXTENSION_SCOPE: ArtifactScope = { kind: "org" };

const CONTRIBUTION_KIND_SET = new Set<string>(EXTENSION_CONTRIBUTION_KINDS);
const isContributionKind = (k: unknown): k is ExtensionContributionKind => typeof k === "string" && CONTRIBUTION_KIND_SET.has(k);

export const EXTENSION_LIMITS = {
  maxName: 200,
  maxPublisher: 200,
  maxVersion: 32,
  maxDescription: 2000,
  maxContributions: 50,
  maxContributionName: 200,
  maxExtensionBytes: 512 * 1024,
} as const;

/** One thing an extension contributes — a typed, pure-JSON config artefact. */
export interface ExtensionContribution {
  id: string;
  kind: ExtensionContributionKind;
  name: string;
  /** The opaque config definition the platform renders (a report/contentPage/dashboard/screen def). */
  def: unknown;
}

/** A stored, installed extension row. */
export interface Extension {
  id: string;
  name: string;
  publisher: string;
  version: string;
  description: string | null;
  status: ExtensionStatus;
  contributions: ExtensionContribution[];
  installedAt: string;
  installedBy: string | null;
  updatedAt: string;
  rowVersion: number;
}

/** The list projection of an extension (contribution defs dropped). */
export interface ExtensionMeta {
  id: string;
  name: string;
  publisher: string;
  version: string;
  status: ExtensionStatus;
  contributionCount: number;
  contributionKinds: ExtensionContributionKind[];
  installedAt: string;
  updatedAt: string;
}

export interface SanitizedExtensionInstall {
  name: string;
  publisher: string;
  version: string;
  description: string | null;
  contributions: ExtensionContribution[];
}

/** Sanitise one contribution (a kind, a name, and its bounded pure-JSON def). Throws {@link ExtensionError}. */
export function sanitizeContribution(raw: unknown, index: number): ExtensionContribution {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ExtensionError("each contribution must be an object");
  const obj = raw as Record<string, unknown>;
  if (!isContributionKind(obj["kind"])) throw new ExtensionError(`a contribution kind must be one of ${EXTENSION_CONTRIBUTION_KINDS.join(", ")}`);
  const name = cleanText(obj["name"], EXTENSION_LIMITS.maxContributionName).trim();
  if (!name) throw new ExtensionError("a contribution needs a name");
  const def = obj["def"];
  if (def === undefined || def === null || typeof def !== "object") throw new ExtensionError("a contribution needs a JSON def object");
  return { id: cleanText(obj["id"], 64) || `c-${index + 1}`, kind: obj["kind"], name, def };
}

/** Sanitise a whole extension install manifest — the single choke point. Throws {@link ExtensionError} (→ 400). */
export function sanitizeExtensionInstall(raw: unknown): SanitizedExtensionInstall {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const name = cleanText(obj["name"], EXTENSION_LIMITS.maxName).trim();
  if (!name) throw new ExtensionError("an extension needs a name");
  const publisher = cleanText(obj["publisher"], EXTENSION_LIMITS.maxPublisher).trim();
  if (!publisher) throw new ExtensionError("an extension needs a publisher");
  const version = cleanText(obj["version"], EXTENSION_LIMITS.maxVersion).trim() || "1.0.0";
  const description = cleanText(obj["description"], EXTENSION_LIMITS.maxDescription).trim();
  const rawContributions = obj["contributions"];
  if (!Array.isArray(rawContributions)) throw new ExtensionError("contributions must be an array");
  if (rawContributions.length === 0) throw new ExtensionError("an extension must contribute at least one thing");
  if (rawContributions.length > EXTENSION_LIMITS.maxContributions) throw new ExtensionError(`an extension may contribute at most ${EXTENSION_LIMITS.maxContributions} things`);
  const contributions = rawContributions.map((c, i) => sanitizeContribution(c, i));
  const serialized = JSON.stringify({ name, publisher, contributions });
  if (serialized.length > EXTENSION_LIMITS.maxExtensionBytes) throw new ExtensionError("the extension is too large");
  return { name, publisher, version, description: description || null, contributions };
}

/** Build the row for a freshly installed extension (identity + timestamps stamped from ctx). */
export function newExtensionRow(id: string, input: SanitizedExtensionInstall, ctx: ActorContext, now: string): Extension {
  return {
    id,
    name: input.name,
    publisher: input.publisher,
    version: input.version,
    description: input.description,
    status: "installed",
    contributions: input.contributions,
    installedAt: now,
    installedBy: actorLabel(ctx),
    updatedAt: now,
    rowVersion: 1,
  };
}

/** Set an installed extension's status (installed ↔ disabled). Bumps rowVersion. */
export function setExtensionStatus(existing: Extension, status: ExtensionStatus, now: string): Extension {
  return { ...existing, status, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 };
}

/** The metadata view of an extension (contribution defs dropped) — the list projection. */
export function extensionMeta(ext: Extension): ExtensionMeta {
  const contributions = ext.contributions ?? [];
  return {
    id: ext.id,
    name: ext.name,
    publisher: ext.publisher,
    version: ext.version,
    status: ext.status ?? "installed",
    contributionCount: contributions.length,
    contributionKinds: [...new Set(contributions.map((c) => c.kind))],
    installedAt: ext.installedAt,
    updatedAt: ext.updatedAt,
  };
}

/** True when a stored extension ROW is safe to reimport from a backup: a string id + name, and every
 *  contribution re-passes `sanitizeContribution` (the pure-JSON def surface — the only risk surface, since an
 *  extension ships NO code). The def-store import calls this so a tampered/injected manifest is dropped, not
 *  written — the same "importer re-validates" rule the def rows follow. */
export function isImportableExtension(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string" || !r["id"]) return false;
  if (typeof r["name"] !== "string" || !r["name"]) return false;
  if (!Array.isArray(r["contributions"])) return false;
  try { (r["contributions"] as unknown[]).forEach((c, i) => sanitizeContribution(c, i)); } catch { return false; }
  return true;
}

/** Every installed extension (org scope). */
export const listExtensions = (): Extension[] => listArtifacts<Extension>(EXTENSION_ARTIFACT, EXTENSION_SCOPE);
export const getExtension = (id: string): Extension | null => getArtifact<Extension>(EXTENSION_ARTIFACT, EXTENSION_SCOPE, id);
export const putExtension = (ext: Extension): void => putArtifact(EXTENSION_ARTIFACT, EXTENSION_SCOPE, ext);
export const deleteExtension = (id: string): boolean => deleteArtifact(EXTENSION_ARTIFACT, EXTENSION_SCOPE, id);

/**
 * Every contribution of a given kind across all ACTIVE (installed, not disabled) extensions — the read-side
 * hook the app uses to surface extension-provided reports / pages / dashboards / screens. Pure over the store.
 */
export function activeContributions(kind: ExtensionContributionKind): Array<ExtensionContribution & { extensionId: string; extensionName: string }> {
  const out: Array<ExtensionContribution & { extensionId: string; extensionName: string }> = [];
  for (const ext of listExtensions()) {
    if (ext.status !== "installed") continue;
    for (const c of ext.contributions ?? []) if (c.kind === kind) out.push({ ...c, extensionId: ext.id, extensionName: ext.name });
  }
  return out;
}
