import { randomUUID } from "node:crypto";
import { artifactStoreEnabled, makeScopedId, listArtifacts, replaceArtifacts } from "./artifact-store";
import { DEF_ARTIFACT, getDef, newStoredDef, type StoredDef } from "./def-import";
import { sanitizeText } from "./coerce";
import { resolveConfig, type ConfigScopes } from "./scoped-config";
import type { ActorContext } from "../broker/types";

/**
 * ORG IDENTITY — the canonical, first-class record of WHO this deployment belongs to: a stable org `id` and a
 * human `name`. OmniProject is single-tenant (one deployment = one org), yet the org still needs a durable
 * identity: an id that never changes (so exports, audit trails and federation can name the org unambiguously)
 * and a name the admin sets in the very first setup step.
 *
 * It rides the same `config`-def rails as every other migrated config (scoped, importer-validated, sealed), but
 * with two deliberate properties that set it apart:
 *   1. UNGATED name. The org name is NOT the premium white-label `appName` (branding) — a fresh deployment can
 *      always name itself, licence or none. Branding stays a separate premium override on top.
 *   2. TOP of the org JSON. The directive "org id should be at top of org level json" is honoured literally:
 *      `writeOrgIdentity` PREPENDS the org-identity row to the org def collection, so the org's own identity is
 *      the first thing you see when you open the org-level store, and the object lists `id` before `name`.
 */

/** The logical config-def id holding the org identity (`{ id, name }`) at org scope. */
export const ORG_IDENTITY_CONFIG_ID = "org-identity";

/** The stable storage id of the org-scope org-identity config def (singleton — one identity per deployment). */
export const ORG_IDENTITY_DEF_ID = makeScopedId("org", `config-${ORG_IDENTITY_CONFIG_ID}`);

/** The org's canonical identity: an immutable id + a human name. `id` is first, by design (top of the JSON). */
export interface OrgIdentity {
  /** Stable, immutable org id — minted once, never rewritten. Names the org in exports, audit + federation. */
  id: string;
  /** The org's display name (ungated — set in first-run setup, distinct from the premium `appName`). */
  name: string;
  /** The org's OWN logo (ungated) — a raster `data:` image URI or an absolute https URL, or `""` when none.
   *  Distinct from the premium `branding.logoUrl` (which white-labels the PRODUCT chrome): this is the org's
   *  asset for THEIR deliverables. */
  logo: string;
  /** Opt-in to surface the org logo on screens / reports / exports. Off by default (a stored logo is inert
   *  until the org chooses to show it). */
  showLogo: boolean;
}

/** The fallback name before the admin names the org (never persisted as a real name). */
export const DEFAULT_ORG_NAME = "Your organisation";

/** Max stored logo length. A `data:` URI is base64, so this bounds the decoded image to ~192 KB — comfortably
 *  within the def payload cap while big enough for a crisp logo. */
export const MAX_LOGO_LEN = 256 * 1024;

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** The raw `values` of the org-scope org-identity def, or `{}` when unset / store off. */
function orgIdentityValues(): { id?: string; name?: string; logo?: string; showLogo?: boolean } {
  if (!artifactStoreEnabled()) return {};
  const row = getDef({ kind: "org" }, ORG_IDENTITY_DEF_ID);
  const v = (row?.payload as { values?: unknown } | undefined)?.values;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  return {
    ...(isStr(o["id"]) ? { id: o["id"] } : {}),
    ...(isStr(o["name"]) ? { name: o["name"] } : {}),
    ...(isStr(o["logo"]) ? { logo: o["logo"] } : {}),
    ...(typeof o["showLogo"] === "boolean" ? { showLogo: o["showLogo"] } : {}),
  };
}

/** A fresh, unique org id. Minted exactly once per deployment (on first ensure/name) and then immutable. */
export function mintOrgId(): string {
  return `org_${randomUUID()}`;
}

/**
 * The org identity as it currently stands — the stored id (or `""` when not yet minted) and the stored name
 * (or the default placeholder). A pure read: does NOT mint an id (use {@link ensureOrgIdentity} for that), so a
 * plain GET never has a write side effect.
 */
export function readOrgIdentity(): OrgIdentity {
  const v = orgIdentityValues();
  return { id: v.id ?? "", name: v.name ?? DEFAULT_ORG_NAME, logo: v.logo ?? "", showLogo: v.showLogo ?? false };
}

/**
 * The effective org identity at a scope: the stored org-scope identity with any config-def layers folded on top
 * (an org id can never be overridden lower down, but this keeps the read consistent with every other config).
 */
export function resolveOrgIdentity(scopes: ConfigScopes = {}): OrgIdentity {
  return resolveConfig(ORG_IDENTITY_CONFIG_ID, readOrgIdentity(), scopes);
}

/** Write the org-identity def as the FIRST row of the org def collection (prepend, replacing any prior copy) —
 *  so the org's identity literally sits at the top of the org-level JSON. One sealed re-write of the org store. */
function writeOrgIdentityRow(row: StoredDef): void {
  const rest = listArtifacts<StoredDef>(DEF_ARTIFACT, { kind: "org" }).filter((r) => r.id !== ORG_IDENTITY_DEF_ID);
  replaceArtifacts(DEF_ARTIFACT, { kind: "org" }, [row, ...rest]);
}

/** Build (or update) the org-identity def row for the given identity. `id` listed FIRST in the payload values,
 *  honouring "org id at the top". Preserves the created-at/version of an existing row. */
function buildOrgIdentityRow(identity: OrgIdentity, ctx: ActorContext, now: string): StoredDef {
  const payload = { id: ORG_IDENTITY_CONFIG_ID, values: { id: identity.id, name: identity.name, logo: identity.logo, showLogo: identity.showLogo } };
  const existing = getDef({ kind: "org" }, ORG_IDENTITY_DEF_ID);
  return existing
    ? { ...existing, payload, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 }
    : newStoredDef(ORG_IDENTITY_DEF_ID, { kind: "config", name: "Organisation", payload, value: payload }, ctx, now);
}

/**
 * Ensure the org has a stable id, minting one (and persisting the identity at the top of the org JSON) if it
 * doesn't yet. Idempotent — an already-minted id is never rewritten. Returns the resulting identity. No-op read
 * when the store is disabled (returns an id-less identity — nothing can be persisted anyway).
 */
export function ensureOrgIdentity(ctx: ActorContext, now: string): OrgIdentity {
  if (!artifactStoreEnabled()) return readOrgIdentity();
  const current = readOrgIdentity();
  if (current.id) return current;
  const minted: OrgIdentity = { ...current, id: mintOrgId() };
  writeOrgIdentityRow(buildOrgIdentityRow(minted, ctx, now));
  return minted;
}

/** Sanitise a proposed org name: single line, trimmed, capped. Empty → the default placeholder. */
export function sanitizeOrgName(raw: unknown): string {
  return sanitizeText(raw, 200, { newlines: false, trim: true }) || DEFAULT_ORG_NAME;
}

/** Raster image `data:` URIs we accept for a logo. Inline SVG is DELIBERATELY excluded — an SVG can carry
 *  script, so an org logo rendered into a page/report would be an XSS vector; raster formats can't execute. */
const LOGO_DATA_URI = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

/**
 * Sanitise a proposed org logo. Accepts an absolute https URL or a RASTER `data:` image URI (png/jpeg/webp/gif),
 * length-capped. Empty / null clears it. Throws on anything else (a non-string, an SVG/other data URI, an
 * http/relative URL, or an over-cap blob) so a bad or unsafe logo can never reach a rendered surface.
 */
export function sanitizeOrgLogo(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string") throw new Error("logo must be a string");
  const v = raw.trim();
  if (v.length > MAX_LOGO_LEN) throw new Error(`logo is too large (max ${Math.floor(MAX_LOGO_LEN / 1024)} KB)`);
  if (/^https:\/\//i.test(v)) return v;
  if (LOGO_DATA_URI.test(v)) return v;
  throw new Error("logo must be an https URL or a base64 png/jpeg/webp/gif data URI");
}

/** A partial edit to the org identity (the id is never part of a patch — it is immutable). */
export interface OrgIdentityPatch { name?: unknown; logo?: unknown; showLogo?: unknown }

/**
 * Apply an (ungated) patch to the org identity — name, logo and/or the show-logo opt-in — minting the id first
 * if needed. The id is IMMUTABLE: a caller can never set it here. Only the keys present in `patch` change;
 * omitted keys are preserved. Persists at the top of the org JSON and returns the new identity. Throws on an
 * invalid logo. Requires the store.
 */
export function updateOrgIdentity(patch: OrgIdentityPatch, ctx: ActorContext, now: string): OrgIdentity {
  const base = ensureOrgIdentity(ctx, now);
  const id = base.id || mintOrgId();
  const next: OrgIdentity = {
    id,
    name: patch.name !== undefined ? sanitizeOrgName(patch.name) : base.name,
    logo: patch.logo !== undefined ? sanitizeOrgLogo(patch.logo) : base.logo,
    showLogo: patch.showLogo !== undefined ? Boolean(patch.showLogo) : base.showLogo,
  };
  writeOrgIdentityRow(buildOrgIdentityRow(next, ctx, now));
  return next;
}

/**
 * Set the org NAME (ungated), minting the id first if needed. Thin wrapper over {@link updateOrgIdentity}.
 */
export function setOrgName(raw: unknown, ctx: ActorContext, now: string): OrgIdentity {
  return updateOrgIdentity({ name: raw }, ctx, now);
}
