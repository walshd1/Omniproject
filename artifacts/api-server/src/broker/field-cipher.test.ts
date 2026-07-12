import { test } from "node:test";
import assert from "node:assert/strict";
import { encComponent, decComponent, matchComponent } from "./field-cipher";

test("encComponent is deterministic (same label+value ⇒ same ciphertext) and opaque", () => {
  const a = encComponent("field", "duedate");
  assert.equal(a, encComponent("field", "duedate")); // deterministic → matchable
  assert.doesNotMatch(a, /duedate/); // opaque
  assert.match(a, /^[A-Za-z0-9_-]+$/); // base64url
});

test("decComponent reverses encComponent for any value", () => {
  for (const v of ["duedate", "custom.field:Due Date / target", "", "工期", "a\tb\nc"]) {
    assert.equal(decComponent("field", encComponent("field", v)), v);
  }
});

test("label domain-separates components: equal values under different labels never collide", () => {
  const v = "shared-value";
  assert.notEqual(encComponent("project", v), encComponent("vendor", v));
  // A piece is only decryptable/matchable under the label it was made with (GCM AAD binding).
  assert.equal(decComponent("vendor", encComponent("project", v)), null);
});

test("decComponent returns null for a tampered or malformed piece (GCM auth)", () => {
  const piece = encComponent("field", "duedate");
  assert.equal(decComponent("field", piece.slice(0, -2) + "AA"), null); // flipped ciphertext bits
  assert.equal(decComponent("field", "short"), null); // too short to hold nonce+tag
  assert.equal(decComponent("field", "!!!not-base64url!!!"), null);
});

test("matchComponent compares a piece to a candidate value", () => {
  const piece = encComponent("project", "guid-A");
  assert.equal(matchComponent(piece, "project", "guid-A"), true);
  assert.equal(matchComponent(piece, "project", "guid-B"), false);
  assert.equal(matchComponent(piece, "vendor", "guid-A"), false); // wrong label
});
