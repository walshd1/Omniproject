import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeWhiteboardWrite, sanitizeWhiteboardScene, sanitizeCanvasElement, WhiteboardError,
  makeWhiteboardId, parseWhiteboardId, whiteboardScope, newJsonBoardRow, mergeJsonBoardRow, boardMeta,
} from "./whiteboard";
import type { ActorContext, Whiteboard } from "../broker/types";
import { CANVAS_LIMITS } from "@workspace/backend-catalogue";

/** The whiteboard sanitiser — typed canvas-element primitives, per-type field allow-listing, bounds. */

test("a valid scene round-trips its typed elements + a background colour", () => {
  const w = sanitizeWhiteboardWrite({
    name: "Board",
    scene: {
      elements: [
        { id: "s1", type: "sticky", x: 10, y: 20, text: "Do the thing", color: "green" },
        { id: "sh1", type: "shape", x: 100, y: 0, shape: "ellipse" },
      ],
      appState: { viewBackgroundColor: "#fff", zoom: 2 },
    },
  });
  assert.equal(w.name, "Board");
  assert.equal(w.scene.elements.length, 2);
  assert.equal(w.scene.elements[0]!.type, "sticky");
  assert.equal(w.scene.elements[0]!.color, "green");
  assert.deepEqual(w.scene.appState, { viewBackgroundColor: "#fff" }); // only the allow-listed key survives
});

test("a name is required", () => {
  assert.throws(() => sanitizeWhiteboardWrite({ name: "   ", scene: { elements: [] } }), WhiteboardError);
});

test("elements must be an array; too many is rejected", () => {
  assert.throws(() => sanitizeWhiteboardScene({ elements: "nope" }), WhiteboardError);
  const tooMany = Array.from({ length: CANVAS_LIMITS.maxElements + 1 }, (_, i) => ({ id: `e${i}`, type: "sticky" }));
  assert.throws(() => sanitizeWhiteboardScene({ elements: tooMany }), WhiteboardError);
});

test("unknown element types are dropped, not stored (freeform but bounded)", () => {
  const scene = sanitizeWhiteboardScene({
    elements: [
      { id: "img", type: "image", fileId: "blob" }, // not a canvas primitive → dropped
      { id: "ok", type: "sticky", x: 0, y: 0 },
      "garbage",
      { id: "evil", type: "text", text: "hi", onClick: "steal()" }, // extra field ignored (allow-list)
    ],
  });
  assert.deepEqual(scene.elements.map((e) => e.id), ["ok", "evil"]);
  // The smuggled field never survives the per-type allow-list.
  assert.equal("onClick" in scene.elements[1]!, false);
});

test("an invalid shape / colour normalises to a safe default", () => {
  const el = sanitizeCanvasElement({ id: "x", type: "shape", shape: "hexagon" }, 0)!;
  assert.equal(el.shape, "rectangle");
  const sticky = sanitizeCanvasElement({ id: "y", type: "sticky", color: "chartreuse" }, 0)!;
  assert.equal(sticky.color, "yellow");
});

test("element links are restricted to safe schemes", () => {
  const bad = sanitizeCanvasElement({ id: "a", type: "sticky", link: "javascript:alert(1)" }, 0)!;
  assert.equal("link" in bad, false, "unsafe link dropped");
  const good = sanitizeCanvasElement({ id: "b", type: "sticky", link: "https://example.com/x" }, 0)!;
  assert.equal(good.link, "https://example.com/x", "safe link kept");
});

test("coordinates are clamped to a finite range", () => {
  const el = sanitizeCanvasElement({ id: "c", type: "sticky", x: 1e12, y: NaN }, 0)!;
  assert.ok(el.x <= 1_000_000, "x clamped");
  assert.equal(el.y, 0, "NaN → default");
});

test("a freehand draw element keeps bounded points; an empty one is dropped", () => {
  const many = Array.from({ length: CANVAS_LIMITS.maxDrawPoints + 500 }, (_, i) => [i, i]);
  const el = sanitizeCanvasElement({ id: "d", type: "draw", x: 0, y: 0, points: many, strokeWidth: 999 }, 0)!;
  assert.equal(el.type, "draw");
  assert.equal(el.points!.length, CANVAS_LIMITS.maxDrawPoints, "points capped");
  assert.ok(el.strokeWidth! <= 64, "stroke width clamped");
  assert.equal(sanitizeCanvasElement({ id: "empty", type: "draw", x: 0, y: 0, points: [] }, 0), null, "no points → dropped");
});

test("an oversized scene is rejected (total size, after per-element caps)", () => {
  // Each element's text is capped, but enough max-size elements still blow the total-scene budget.
  const many = Array.from({ length: 1000 }, (_, i) => ({ id: `t${i}`, type: "text", text: "x".repeat(CANVAS_LIMITS.maxText) }));
  assert.throws(() => sanitizeWhiteboardScene({ elements: many }), WhiteboardError);
});

// ── Storage-target model: self-describing ids, scope resolution, JSON row building ──────────────────────────

test("storage defaults to the private user area; a project target needs a projectId", () => {
  assert.equal(sanitizeWhiteboardWrite({ name: "N", scene: { elements: [] } }).storage, "user");
  assert.equal(sanitizeWhiteboardWrite({ name: "N", storage: "org", scene: { elements: [] } }).storage, "org");
  // unknown target falls back to the safe default
  assert.equal(sanitizeWhiteboardWrite({ name: "N", storage: "s3", scene: { elements: [] } }).storage, "user");
  assert.throws(() => sanitizeWhiteboardWrite({ name: "N", storage: "project", scene: { elements: [] } }), WhiteboardError);
});

test("ids are self-describing and round-trip through parse", () => {
  assert.equal(makeWhiteboardId("user", "abc"), "user~abc");
  assert.equal(makeWhiteboardId("org", "abc"), "org~abc");
  assert.equal(makeWhiteboardId("project", "uuid", "proj-1"), "project~proj-1~uuid");
  assert.deepEqual(parseWhiteboardId("user~abc"), { storage: "user", localId: "abc" });
  assert.deepEqual(parseWhiteboardId("org~abc"), { storage: "org", localId: "abc" });
  assert.deepEqual(parseWhiteboardId("project~proj-1~uuid"), { storage: "project", projectId: "proj-1", localId: "uuid" });
  assert.equal(parseWhiteboardId("garbage"), null, "no delimiter → not a board id");
  assert.equal(parseWhiteboardId("bogus~x"), null, "unknown storage word → rejected");
});

test("a user scope ALWAYS uses the caller's own sub (never the id) — cross-user is structurally impossible", () => {
  const parsed = parseWhiteboardId("user~someoneElsesBoard")!;
  assert.deepEqual(whiteboardScope(parsed, "me"), { kind: "user", sub: "me" });
  assert.deepEqual(whiteboardScope(parseWhiteboardId("org~x")!, "me"), { kind: "org" });
  assert.deepEqual(whiteboardScope(parseWhiteboardId("project~p~x")!, "me"), { kind: "project", projectId: "p" });
});

test("newJsonBoardRow stamps the owner from ctx (never the client) and records storage + timestamp", () => {
  const ctx: ActorContext = { sub: "owner-1", email: "o@x.io" };
  const input = sanitizeWhiteboardWrite({ name: "Mine", storage: "user", scene: { elements: [] } });
  const row = newJsonBoardRow("user~id1", input, ctx, "2026-01-01T00:00:00.000Z");
  assert.equal(row.ownerSub, "owner-1");
  assert.equal(row.storage, "user");
  assert.equal(row.updatedBy, "o@x.io");
  assert.equal(row.updatedAt, "2026-01-01T00:00:00.000Z");
  // an update preserves id + owner + storage, refreshing only the mutable fields
  const merged = mergeJsonBoardRow(row, sanitizeWhiteboardWrite({ name: "Renamed", storage: "user", scene: { elements: [] } }), { sub: "someone-else" }, "2026-02-02T00:00:00.000Z");
  assert.equal(merged.id, "user~id1");
  assert.equal(merged.ownerSub, "owner-1", "a write cannot re-own a board");
  assert.equal(merged.name, "Renamed");
  assert.equal(merged.updatedAt, "2026-02-02T00:00:00.000Z");
});

test("boardMeta drops the scene body", () => {
  const board: Whiteboard = { id: "org~1", name: "B", storage: "org", scene: { elements: [{ id: "e", type: "sticky", x: 0, y: 0 }] }, updatedAt: "t" };
  const meta = boardMeta(board);
  assert.equal("scene" in meta, false, "the list projection has no scene");
  assert.equal(meta.id, "org~1");
  assert.equal(meta.storage, "org");
});
