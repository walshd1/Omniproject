import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NATIVE_SURFACE_KINDS, vendorHost, buildVendorUrl, sanitizeHandoffRequest, sanitizeImportRequest, NativeHandoffError,
} from "./native-handoff";

/**
 * Native handoff helpers (roadmap X.1). The invariant under test: a handoff URL is only ever built against a
 * vendor's ALLOWLISTED host, and an externalRef URL is accepted only when its host matches — so a caller can
 * never smuggle an off-host redirect / SSRF pivot through the vendor bridge.
 */

test("known vendors map to a host; unknown vendors don't", () => {
  assert.equal(vendorHost("miro"), "miro.com");
  assert.equal(vendorHost("notion"), "www.notion.so");
  assert.equal(vendorHost("evil"), null);
});

test("buildVendorUrl builds against the allowlisted host only", () => {
  assert.equal(buildVendorUrl("miro", "whiteboard", "open"), "https://miro.com/omni/whiteboard/open");
  assert.equal(buildVendorUrl("miro", "whiteboard", "create"), "https://miro.com/omni/whiteboard/new");
  // A bare external id is appended (encoded) to the vendor host path.
  assert.equal(buildVendorUrl("miro", "whiteboard", "open", "board-42"), "https://miro.com/omni/whiteboard/board-42");
  // A full externalRef URL is accepted ONLY when its host matches the vendor.
  assert.equal(buildVendorUrl("miro", "whiteboard", "open", "https://miro.com/app/board/xyz"), "https://miro.com/app/board/xyz");
  assert.throws(() => buildVendorUrl("miro", "whiteboard", "open", "https://evil.example/app"), NativeHandoffError);
  assert.throws(() => buildVendorUrl("miro", "whiteboard", "open", "http://miro.com/x"), /https/);
  assert.throws(() => buildVendorUrl("evil", "whiteboard", "open"), NativeHandoffError);
});

test("sanitizeHandoffRequest validates kind/vendor/action", () => {
  const r = sanitizeHandoffRequest({ kind: "whiteboard", vendor: "miro", action: "open", contextRef: { projectId: "p1", issueId: "i1" } });
  assert.equal(r.vendor, "miro");
  assert.equal(r.contextRef?.projectId, "p1");
  assert.throws(() => sanitizeHandoffRequest({ kind: "nope", vendor: "miro", action: "open" }), NativeHandoffError);
  assert.throws(() => sanitizeHandoffRequest({ kind: "whiteboard", vendor: "evil", action: "open" }), /non-allowlisted/);
  assert.throws(() => sanitizeHandoffRequest({ kind: "whiteboard", vendor: "miro", action: "delete" }), NativeHandoffError);
});

test("sanitizeImportRequest requires a target project + a handoffId or externalRef", () => {
  const r = sanitizeImportRequest({ kind: "whiteboard", vendor: "miro", externalRef: "board-42", target: { projectId: "p1", issueId: "i1" } });
  assert.equal(r.target.projectId, "p1");
  assert.equal(r.externalRef, "board-42");
  assert.throws(() => sanitizeImportRequest({ kind: "whiteboard", vendor: "miro", target: {} }), /projectId/);
  assert.throws(() => sanitizeImportRequest({ kind: "whiteboard", vendor: "miro", target: { projectId: "p1" } }), /handoffId or externalRef/);
});

test("NATIVE_SURFACE_KINDS is the expected closed set", () => {
  assert.deepEqual([...NATIVE_SURFACE_KINDS], ["whiteboard", "document", "diagram", "sheet", "board", "schedule", "dashboard", "report", "form", "wiki"]);
});
