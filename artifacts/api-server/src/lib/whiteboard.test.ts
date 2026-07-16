import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeWhiteboardWrite, sanitizeWhiteboardScene, sanitizeCanvasElement, WhiteboardError } from "./whiteboard";
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

test("an oversized scene is rejected (total size, after per-element caps)", () => {
  // Each element's text is capped, but enough max-size elements still blow the total-scene budget.
  const many = Array.from({ length: 1000 }, (_, i) => ({ id: `t${i}`, type: "text", text: "x".repeat(CANVAS_LIMITS.maxText) }));
  assert.throws(() => sanitizeWhiteboardScene({ elements: many }), WhiteboardError);
});
