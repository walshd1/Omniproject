import type { NativeHandoffRequest, NativeImportRequest, NativeSurfaceKind } from "../broker/types";

/**
 * NATIVE HANDOFF helpers (companion-app bridge, roadmap X.1 — see docs/NATIVE-HANDOFF.md). The security
 * invariant this module upholds: a handoff URL is built ONLY against a vendor's ALLOWLISTED real host, never
 * from user-supplied host input — so "vendor X" can only ever deep-link into vendor X's real domain (no open
 * redirect, no SSRF pivot). Request validation + URL minting live here; a connector's `nativeHandoff` builds
 * its URL through `buildVendorUrl`.
 */

export const NATIVE_SURFACE_KINDS: readonly NativeSurfaceKind[] = [
  "whiteboard", "document", "diagram", "sheet", "board", "schedule", "dashboard", "report", "form", "wiki",
];
const KIND_SET = new Set<string>(NATIVE_SURFACE_KINDS);
export const isNativeSurfaceKind = (k: unknown): k is NativeSurfaceKind => typeof k === "string" && KIND_SET.has(k);

const ACTIONS = new Set(["open", "create", "embed"]);

/** Vendor → its real, allowlisted host. A handoff URL is only ever built against one of these. */
export const VENDOR_HOSTS: Record<string, string> = {
  miro: "miro.com",
  lucid: "lucid.app",
  figma: "www.figma.com",
  notion: "www.notion.so",
  confluence: "www.atlassian.com",
  "google-docs": "docs.google.com",
  smartsheet: "app.smartsheet.com",
  "google-sheets": "docs.google.com",
  airtable: "airtable.com",
  jira: "www.atlassian.com",
  monday: "monday.com",
  "ms-project": "project.microsoft.com",
  powerbi: "app.powerbi.com",
  tableau: "www.tableau.com",
  looker: "looker.com",
  // The demo connector's illustrative vendor.
  demoboard: "example.com",
};

/** The allowlisted host for a vendor, or null when the vendor isn't known. */
export function vendorHost(vendor: string): string | null {
  return Object.prototype.hasOwnProperty.call(VENDOR_HOSTS, vendor) ? VENDOR_HOSTS[vendor]! : null;
}

/** A rejected native-handoff request (→ 400). */
export class NativeHandoffError extends Error {
  constructor(message: string) { super(message); this.name = "NativeHandoffError"; }
}

const str = (v: unknown, max = 512): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Validate + normalise a handoff request. Throws {@link NativeHandoffError} (→ 400). */
export function sanitizeHandoffRequest(raw: unknown): NativeHandoffRequest {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (!isNativeSurfaceKind(o["kind"])) throw new NativeHandoffError(`kind must be one of ${NATIVE_SURFACE_KINDS.join(", ")}`);
  const vendor = str(o["vendor"], 60);
  if (!vendorHost(vendor)) throw new NativeHandoffError(`unknown or non-allowlisted vendor "${vendor}"`);
  const action = str(o["action"], 10);
  if (!ACTIONS.has(action)) throw new NativeHandoffError("action must be open, create or embed");
  const externalRef = str(o["externalRef"], 1024);
  const ctxRaw = (o["contextRef"] ?? undefined) as Record<string, unknown> | undefined;
  const contextRef = ctxRaw ? {
    ...(str(ctxRaw["projectId"], 128) ? { projectId: str(ctxRaw["projectId"], 128) } : {}),
    ...(str(ctxRaw["issueId"], 128) ? { issueId: str(ctxRaw["issueId"], 128) } : {}),
    ...(str(ctxRaw["entity"], 60) ? { entity: str(ctxRaw["entity"], 60) } : {}),
    ...(str(ctxRaw["id"], 128) ? { id: str(ctxRaw["id"], 128) } : {}),
  } : undefined;
  return {
    kind: o["kind"], vendor, action: action as "open" | "create" | "embed",
    ...(externalRef ? { externalRef } : {}),
    ...(contextRef ? { contextRef } : {}),
  };
}

/** Validate + normalise an import request (reference mode). Throws {@link NativeHandoffError} (→ 400). */
export function sanitizeImportRequest(raw: unknown): NativeImportRequest {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (!isNativeSurfaceKind(o["kind"])) throw new NativeHandoffError(`kind must be one of ${NATIVE_SURFACE_KINDS.join(", ")}`);
  const vendor = str(o["vendor"], 60);
  if (!vendorHost(vendor)) throw new NativeHandoffError(`unknown or non-allowlisted vendor "${vendor}"`);
  const target = (o["target"] ?? {}) as Record<string, unknown>;
  const projectId = str(target["projectId"], 128);
  if (!projectId) throw new NativeHandoffError("target.projectId is required");
  const handoffId = str(o["handoffId"], 128);
  const externalRef = str(o["externalRef"], 1024);
  if (!handoffId && !externalRef) throw new NativeHandoffError("a handoffId or externalRef is required to import");
  const issueId = str(target["issueId"], 128);
  return {
    kind: o["kind"], vendor,
    ...(handoffId ? { handoffId } : {}),
    ...(externalRef ? { externalRef } : {}),
    target: { projectId, ...(issueId ? { issueId } : {}) },
  };
}

/**
 * Build a vetted vendor URL against the vendor's ALLOWLISTED host. `externalRef`, when given, may be a bare
 * id (appended to the path) OR a full URL — but a full URL is only accepted when its host matches the vendor's
 * allowlisted host (else rejected), so a caller can never smuggle an off-host redirect through it.
 */
export function buildVendorUrl(vendor: string, kind: NativeSurfaceKind, action: "open" | "create" | "embed", externalRef?: string): string {
  const host = vendorHost(vendor);
  if (!host) throw new NativeHandoffError(`unknown or non-allowlisted vendor "${vendor}"`);
  if (externalRef && /^https?:\/\//i.test(externalRef)) {
    let parsed: URL;
    try { parsed = new URL(externalRef); } catch { throw new NativeHandoffError("externalRef is not a valid URL"); }
    if (parsed.protocol !== "https:") throw new NativeHandoffError("externalRef must be https");
    if (parsed.host.toLowerCase() !== host) throw new NativeHandoffError(`externalRef host must be ${host}`);
    return parsed.toString();
  }
  const segment = externalRef ? `/${encodeURIComponent(externalRef)}` : `/${action === "create" ? "new" : "open"}`;
  return `https://${host}/omni/${encodeURIComponent(kind)}${segment}`;
}
