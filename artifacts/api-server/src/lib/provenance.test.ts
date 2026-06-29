import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { canonical, contentMac, sessionMac, record, recentProvenance, verifyChain, verifyContent, verifySession, provenanceAnchor, verifyProvenanceAnchor, __resetProvenance } from "./provenance";
import { wrapWithProvenance } from "../broker/provenance";
import type { Broker } from "../broker/types";

/**
 * Provenance chain: keyed-MAC, hash-chained fingerprints of broker calls — content-free,
 * tamper-evident, and verifiable by re-presenting the content.
 */
beforeEach(() => __resetProvenance());

test("canonical sorts keys so the fingerprint is stable", () => {
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
});

test("records a chained invoke→result and verifies intact", () => {
  record({ callId: "c1", hop: "invoke", action: "listProjects", actor: "u1", content: ["arg"] });
  record({ callId: "c1", hop: "result", action: "listProjects", actor: "u1", content: [{ id: "p1" }] });
  const entries = recentProvenance();
  assert.equal(entries.length, 2);
  assert.equal(verifyChain(entries).ok, true);
  assert.equal(recentProvenance("c1").length, 2);
});

test("the anchor tracks the tip and is unsigned without Ed25519 signing configured", () => {
  assert.deepEqual({ seq: provenanceAnchor().seq, lastMac: provenanceAnchor().lastMac }, { seq: -1, lastMac: null });
  record({ callId: "c1", hop: "invoke", action: "a", actor: "u1", content: [1] });
  const anchor = provenanceAnchor();
  assert.equal(anchor.seq, 0);
  assert.equal(anchor.lastMac, recentProvenance()[0]!.mac);
  assert.equal(anchor.signature, undefined);
  // Unsigned ⇒ not attributable to the gateway ⇒ verify refuses.
  assert.equal(verifyProvenanceAnchor(anchor, "-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----"), false);
});

test("tampering with any field breaks the chain MAC", () => {
  record({ callId: "c1", hop: "invoke", action: "a", actor: "u1", content: [1] });
  record({ callId: "c1", hop: "result", action: "a", actor: "u1", content: [2] });
  const entries = recentProvenance();
  entries[1] = { ...entries[1]!, contentMac: "deadbeef" }; // forge a content fingerprint
  const v = verifyChain(entries);
  assert.equal(v.ok, false);
  assert.match(v.reason ?? "", /altered/);
});

test("verifyContent proves nothing changed by re-presenting the content", () => {
  record({ callId: "c1", hop: "result", action: "a", actor: "u1", content: { id: "p1", name: "X" } });
  const entry = recentProvenance("c1")[0]!;
  assert.equal(verifyContent(entry, { name: "X", id: "p1" }), true); // key order irrelevant
  assert.equal(verifyContent(entry, { id: "p1", name: "CHANGED" }), false);
});

test("contentMac binds to actor + sequence position (can't be lifted elsewhere)", () => {
  const a = contentMac({ x: 1 }, "u1", 0);
  assert.notEqual(a, contentMac({ x: 1 }, "u2", 0));
  assert.notEqual(a, contentMac({ x: 1 }, "u1", 1));
});

test("records seq + elapsed-since-start offsets; tampering the timeline breaks the chain", () => {
  record({ callId: "c1", hop: "invoke", action: "a", actor: "u1", content: [1] });
  record({ callId: "c1", hop: "result", action: "a", actor: "u1", content: [2] });
  const entries = recentProvenance();
  assert.equal(entries[0]!.seq, 0);
  assert.equal(entries[0]!.elapsedMs, 0); // first entry is the t0 reference
  assert.ok(entries[1]!.elapsedMs >= 0 && entries[1]!.seq === 1);
  // Rewriting the elapsed offset invalidates the entry's MAC.
  entries[1] = { ...entries[1]!, elapsedMs: entries[1]!.elapsedMs + 9_999 };
  assert.equal(verifyChain(entries).ok, false);
});

test("the broker Proxy records actor + invoke + result per call", async () => {
  const stub = { listProjects: async (_ctx: unknown) => [{ id: "p1", name: "P" }] } as unknown as Broker;
  const wrapped = wrapWithProvenance(stub);
  await wrapped.listProjects({ sub: "alice", email: "a@b.c" });
  const entries = recentProvenance();
  assert.ok(entries.some((e) => e.hop === "invoke" && e.actor === "alice" && e.action === "listProjects"));
  assert.ok(entries.some((e) => e.hop === "result" && e.action === "listProjects"));
  assert.equal(verifyChain(entries).ok, true);
});

// ── Session binding ──────────────────────────────────────────────────────────
const bind = { sub: "alice", smono: "12345", salt: "deadbeef" };

test("an entry commits to the initiating session; verifySession re-presents the binding", () => {
  record({ callId: "c1", hop: "invoke", action: "a", actor: "alice", sessionBind: bind, content: [1] });
  const entry = recentProvenance("c1")[0]!;
  assert.ok(entry.sessionMac, "session-bound entries carry a session fingerprint");
  assert.equal(verifySession(entry, bind), true);
  // A different session (different salt) does NOT match.
  assert.equal(verifySession(entry, { ...bind, salt: "cafe" }), false);
  assert.equal(verifySession(entry, null), false); // can't pass it off as a system call
});

test("system/unauthenticated entries bind a null session (and verify as such)", () => {
  record({ callId: "c2", hop: "invoke", action: "ping", actor: null, content: [] });
  const entry = recentProvenance("c2")[0]!;
  assert.equal(entry.sessionMac, null);
  assert.equal(verifySession(entry, null), true);
  assert.equal(verifySession(entry, bind), false); // can't graft a session onto a system call
});

test("sessionMac binds the same identity the broker key uses (sub‖smono‖salt)", () => {
  const base = sessionMac(bind)!;
  assert.notEqual(base, sessionMac({ ...bind, sub: "bob" }));
  assert.notEqual(base, sessionMac({ ...bind, smono: "99999" }));
  assert.notEqual(base, sessionMac({ ...bind, salt: "cafe" }));
  assert.equal(sessionMac(null), null);
});

test("forging the session fingerprint breaks the chain MAC", () => {
  record({ callId: "c1", hop: "invoke", action: "a", actor: "alice", sessionBind: bind, content: [1] });
  record({ callId: "c1", hop: "result", action: "a", actor: "alice", sessionBind: bind, content: [2] });
  const entries = recentProvenance();
  entries[1] = { ...entries[1]!, sessionMac: "deadbeef" }; // swap in another session's fingerprint
  assert.equal(verifyChain(entries).ok, false);
});
