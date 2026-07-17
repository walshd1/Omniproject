/**
 * WHITEBOARD server logic — the authoritative sanitiser + broker access for the visual canvas (roadmap 2.3).
 *
 * SECURITY: a whiteboard scene is a list of CANVAS-ELEMENT PRIMITIVES (sticky/shape/text/connector/frame —
 * the shared `canvas` family), never trusted or executed. `sanitizeWhiteboardWrite` is the single choke
 * point every write passes through: it bounds the element count + total size, and validates EACH element by
 * its type, keeping only the fields that type allows (so a smuggled field — an inline image blob, a script
 * link, an arbitrary bag — can't ride along). Unknown-type or malformed elements are dropped, not stored.
 * Coordinates are clamped to a finite range; text is length-capped; a `link` is kept only for a safe scheme.
 * Scenes are stored as neutral JSON through the broker seam (zero-at-rest); nothing here renders them.
 */
import type { Request } from "express";
import { getBroker, contextFromReq } from "../broker";
import type { ActorContext, Whiteboard, WhiteboardMeta, WhiteboardWrite, WhiteboardScene } from "../broker/types";
import type { StorageTarget } from "./artifact-store";
import { makeScopedId, parseScopedId, scopeFromParsed, isStorageTarget } from "./artifact-store";
import {
  CANVAS_ELEMENT_TYPES, CANVAS_LIMITS, SHAPE_KINDS, STICKY_COLORS,
  type CanvasElement, type CanvasElementType, type ShapeKind, type StickyColor,
} from "@workspace/backend-catalogue";

/** A rejected whiteboard write (maps to 400). */
export class WhiteboardError extends Error {
  constructor(message: string) { super(message); this.name = "WhiteboardError"; }
}

/**
 * Where a board is stored — the caller's CHOICE (permission-gated):
 *   - `user`     the caller's PRIVATE encrypted-JSON area (only they see it).
 *   - `project`  a project's shared encrypted-JSON area (needs project scope).
 *   - `org`      the org-wide shared encrypted-JSON area (needs org-write permission).
 *   - `sidecar`  the built-in system-of-record (the OmniStore), when it's loaded.
 */
export type WhiteboardStorage = StorageTarget;
/** The artifact-store type key for whiteboards. */
export const WHITEBOARD_ARTIFACT = "whiteboard";

/** A sanitised whiteboard write PLUS its chosen storage target. */
export interface SanitizedWhiteboardWrite {
  name: string;
  scene: WhiteboardScene;
  storage: WhiteboardStorage;
  projectId?: string;
}

/** Build a self-describing whiteboard id (shared scoped-id primitive). */
export const makeWhiteboardId = makeScopedId;

/** Parse a self-describing whiteboard id back to its storage + parts, or null if malformed / not a whiteboard
 *  target (the def-only `programme` tier is rejected — a whiteboard is never programme-scoped). */
export function parseWhiteboardId(id: string): { storage: StorageTarget; projectId?: string; localId: string } | null {
  const p = parseScopedId(id);
  if (!p || !isStorageTarget(p.storage)) return null;
  return p.projectId !== undefined
    ? { storage: p.storage, projectId: p.projectId, localId: p.localId }
    : { storage: p.storage, localId: p.localId };
}

/** The encrypted-JSON scope for a non-sidecar id. The caller's OWN sub is always used for a user board, so
 *  the id can never address another user's private area. */
export const whiteboardScope = scopeFromParsed;

/** A board's actor label for the audit `updatedBy` field (email > name > sub). */
const actorLabel = (ctx: ActorContext): string | null => ctx.email ?? ctx.name ?? ctx.sub ?? null;

/**
 * Build the row for a NEW board destined for an encrypted-JSON store. The owner is stamped from `ctx.sub`
 * (never the client), the storage target + self-describing id are recorded, and the scene is the already
 * sanitised one. The `id` is the self-describing id, so a later read routes straight to the right store.
 */
export function newJsonBoardRow(id: string, input: SanitizedWhiteboardWrite, ctx: ActorContext, now: string): Whiteboard {
  return {
    id,
    name: input.name,
    projectId: input.projectId ?? null,
    ownerSub: ctx.sub ?? null,
    storage: input.storage,
    scene: input.scene,
    updatedAt: now,
    updatedBy: actorLabel(ctx),
  };
}

/** Apply an UPDATE to an existing JSON board, preserving its id/owner/storage (a write can't move or reown it). */
export function mergeJsonBoardRow(existing: Whiteboard, input: SanitizedWhiteboardWrite, ctx: ActorContext, now: string): Whiteboard {
  return {
    ...existing,
    name: input.name,
    projectId: input.projectId ?? existing.projectId ?? null,
    scene: input.scene,
    updatedAt: now,
    updatedBy: actorLabel(ctx),
  };
}

/** The metadata view of a board (scene body dropped) — the list projection. */
export function boardMeta(b: Whiteboard): WhiteboardMeta {
  const meta: WhiteboardMeta = { id: b.id, name: b.name, updatedAt: b.updatedAt };
  if (b.projectId !== undefined) meta.projectId = b.projectId;
  if (b.ownerSub !== undefined) meta.ownerSub = b.ownerSub;
  if (b.visibility !== undefined) meta.visibility = b.visibility;
  if (b.storage !== undefined) meta.storage = b.storage;
  if (b.updatedBy !== undefined) meta.updatedBy = b.updatedBy;
  return meta;
}

const ELEMENT_TYPE_SET = new Set<string>(CANVAS_ELEMENT_TYPES);
const SHAPE_SET = new Set<string>(SHAPE_KINDS);
const COLOR_SET = new Set<string>(STICKY_COLORS);
/** URL schemes an element `link` may use — everything else (javascript:, data:, file:, …) is dropped. */
const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);
/** Coordinates are clamped to a finite range so a rogue value can't blow up a renderer. */
const COORD_MIN = -1_000_000;
const COORD_MAX = 1_000_000;

/** Strip control characters and cap length on a free-text value (note text, board name). */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    const printable = c === 9 || c === 10 || (c >= 32 && c !== 127 && !(c >= 128 && c <= 159));
    if (printable) out += ch;
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

/** A finite number clamped to the canvas coordinate range (defaulted when absent/NaN). */
function coord(v: unknown, def = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(COORD_MAX, Math.max(COORD_MIN, n));
}

/** Keep a `link` only when it parses to a safe absolute scheme; else return undefined (drop it). */
function safeLink(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const url = new URL(raw.trim());
    return SAFE_LINK_SCHEMES.has(url.protocol) ? url.href.slice(0, 2000) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sanitise one raw element into a well-formed {@link CanvasElement}, or return null to DROP it (unknown type
 * or unusable). Only the fields that apply to the element's `type` survive.
 */
export function sanitizeCanvasElement(raw: unknown, index: number): CanvasElement | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const type = obj["type"];
  if (typeof type !== "string" || !ELEMENT_TYPE_SET.has(type)) return null;
  const t = type as CanvasElementType;
  const id = cleanText(obj["id"], 64) || `el-${index + 1}`;
  const el: CanvasElement = { id, type: t, x: coord(obj["x"]), y: coord(obj["y"]) };
  const link = safeLink(obj["link"]);
  if (link) el.link = link;

  switch (t) {
    case "sticky": {
      el.w = coord(obj["w"], 160);
      el.h = coord(obj["h"], 120);
      el.text = cleanText(obj["text"], CANVAS_LIMITS.maxText);
      const color = obj["color"];
      el.color = (typeof color === "string" && COLOR_SET.has(color) ? color : "yellow") as StickyColor;
      break;
    }
    case "shape": {
      el.w = coord(obj["w"], 120);
      el.h = coord(obj["h"], 80);
      const shape = obj["shape"];
      el.shape = (typeof shape === "string" && SHAPE_SET.has(shape) ? shape : "rectangle") as ShapeKind;
      const text = cleanText(obj["text"], CANVAS_LIMITS.maxText);
      if (text) el.text = text;
      break;
    }
    case "text": {
      el.text = cleanText(obj["text"], CANVAS_LIMITS.maxText);
      const fs = Number(obj["fontSize"]);
      el.fontSize = Number.isFinite(fs) ? Math.min(200, Math.max(8, fs)) : 16;
      break;
    }
    case "connector": {
      el.x2 = coord(obj["x2"]);
      el.y2 = coord(obj["y2"]);
      const from = cleanText(obj["from"], 64);
      const to = cleanText(obj["to"], 64);
      if (from) el.from = from;
      if (to) el.to = to;
      break;
    }
    case "frame": {
      el.w = coord(obj["w"], 320);
      el.h = coord(obj["h"], 240);
      el.text = cleanText(obj["text"], CANVAS_LIMITS.maxName);
      break;
    }
    case "draw": {
      const rawPts = obj["points"];
      if (!Array.isArray(rawPts)) return null; // a pen stroke without points is meaningless → drop
      const points: number[][] = [];
      for (const p of rawPts) {
        if (!Array.isArray(p) || p.length < 2) continue;
        points.push([coord(p[0]), coord(p[1])]);
        if (points.length >= CANVAS_LIMITS.maxDrawPoints) break;
      }
      if (points.length === 0) return null;
      el.points = points;
      const sw = Number(obj["strokeWidth"]);
      el.strokeWidth = Number.isFinite(sw) ? Math.min(64, Math.max(1, sw)) : 4;
      break;
    }
  }
  return el;
}

/**
 * Sanitise a whole scene: bound element count + total size, validate each element by type, keep a minimal
 * view state. Throws {@link WhiteboardError} on a hard violation (bad shape / oversize).
 */
export function sanitizeWhiteboardScene(raw: unknown): WhiteboardScene {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawElements = obj["elements"];
  if (!Array.isArray(rawElements)) throw new WhiteboardError("a scene needs an elements array");
  if (rawElements.length > CANVAS_LIMITS.maxElements) {
    throw new WhiteboardError(`a scene may have at most ${CANVAS_LIMITS.maxElements} elements`);
  }
  const elements: CanvasElement[] = [];
  for (let i = 0; i < rawElements.length; i++) {
    const el = sanitizeCanvasElement(rawElements[i], i);
    if (el) elements.push(el); // drop unknown/malformed elements rather than fail the whole save
  }

  // Minimal, sanitised view state: only a background colour (short string), nothing else.
  const appStateIn = (obj["appState"] ?? {}) as Record<string, unknown>;
  const appState: Record<string, unknown> = {};
  const bg = cleanText(appStateIn["viewBackgroundColor"], 32);
  if (bg) appState["viewBackgroundColor"] = bg;

  const scene: WhiteboardScene = { elements, appState };
  if (JSON.stringify(scene).length > CANVAS_LIMITS.maxSceneBytes) {
    throw new WhiteboardError("the scene is too large");
  }
  return scene;
}

/**
 * Sanitise a whole whiteboard write — the single choke point for POST/PUT. Validates the name, carries a
 * trimmed projectId when present, and sanitises the scene. Throws {@link WhiteboardError} (→ 400).
 */
export function sanitizeWhiteboardWrite(raw: unknown): SanitizedWhiteboardWrite {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const name = cleanText(obj["name"], CANVAS_LIMITS.maxName).trim();
  if (!name) throw new WhiteboardError("a whiteboard needs a name");
  const scene = sanitizeWhiteboardScene(obj["scene"] ?? { elements: [] });
  // Storage target — the caller's choice, permission-gated at the route. Defaults to the private user area.
  const storage: WhiteboardStorage = isStorageTarget(obj["storage"]) ? obj["storage"] : "user";
  const out: SanitizedWhiteboardWrite = { name, scene, storage };
  const projectId = obj["projectId"];
  if (typeof projectId === "string" && projectId.trim()) out.projectId = projectId.trim();
  if (storage === "project" && !out.projectId) throw new WhiteboardError("a project whiteboard needs a projectId");
  return out;
}

// ── Broker access (thin wrappers; the routes guard capability + RBAC first). ──────────────────────────────

/** Whether the active broker models whiteboards ("if supported by the backend"). */
export const brokerHasWhiteboards = (): boolean => !!getBroker().getWhiteboard;

/** The whiteboards, optionally scoped to a project (scene bodies omitted). */
export const listWhiteboards = (req: Request, projectId?: string): Promise<Whiteboard[]> => {
  const b = getBroker();
  return b.listWhiteboards ? b.listWhiteboards(contextFromReq(req), projectId ? { projectId } : undefined) : Promise.resolve([]);
};
/** One whiteboard by id (with its scene), or null. */
export const getWhiteboard = (req: Request, id: string): Promise<Whiteboard | null> => {
  const b = getBroker();
  return b.getWhiteboard ? b.getWhiteboard(contextFromReq(req), id) : Promise.resolve(null);
};
/** Create/update/delete a whiteboard (throws if unsupported — the route guards first). */
export const writeWhiteboard = (req: Request, op: "create" | "update" | "delete", input: WhiteboardWrite & { id?: string }): Promise<Whiteboard | null> => {
  const b = getBroker();
  if (!b.writeWhiteboard) throw new Error("this backend does not support whiteboards");
  return b.writeWhiteboard(contextFromReq(req), op, input);
};
