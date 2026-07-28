import { test } from "node:test";
import assert from "node:assert/strict";
import { signTicket, verifyTicket } from "./ticket.mjs";

const SECRET = "shared-ticket-secret";

test("a freshly signed ticket verifies for its op + key", () => {
  const t = signTicket({ op: "put", key: "k1", room: "issue:p1:i1", exp: 1000 }, SECRET);
  const p = verifyTicket(t, SECRET, { op: "put", key: "k1" }, 500);
  assert.ok(p);
  assert.equal(p.room, "issue:p1:i1");
});

test("rejects a wrong op, wrong key, or wrong secret", () => {
  const t = signTicket({ op: "put", key: "k1", exp: 1000 }, SECRET);
  assert.equal(verifyTicket(t, SECRET, { op: "get", key: "k1" }, 500), null); // wrong op
  assert.equal(verifyTicket(t, SECRET, { op: "put", key: "other" }, 500), null); // wrong key
  assert.equal(verifyTicket(t, "different-secret", { op: "put", key: "k1" }, 500), null); // wrong secret
});

test("rejects an expired ticket", () => {
  const t = signTicket({ op: "get", key: "k1", exp: 1000 }, SECRET);
  assert.equal(verifyTicket(t, SECRET, { op: "get", key: "k1" }, 1001), null);
});

test("rejects a tampered body or a malformed ticket", () => {
  const t = signTicket({ op: "put", key: "k1", exp: 9999 }, SECRET);
  const tampered = `${Buffer.from(JSON.stringify({ op: "put", key: "k1", exp: 9999, extra: 1 })).toString("base64url")}.${t.split(".")[1]}`;
  assert.equal(verifyTicket(tampered, SECRET, { op: "put", key: "k1" }, 0), null);
  assert.equal(verifyTicket("nodot", SECRET, { op: "put", key: "k1" }, 0), null);
  assert.equal(verifyTicket("", SECRET, { op: "put", key: "k1" }, 0), null);
});
