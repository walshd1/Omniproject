#!/usr/bin/env node
// Offline verifier for the tamper-evident audit chain.
//
// Reads sealed audit events (NDJSON — one JSON object per line, as shipped to the SIEM) and
// recomputes the keyed hash chain to detect any removed/reordered/altered event. Needs the
// same audit key material the gateway used (AUDIT_KEY, or the fallback master).
//
// Usage:
//   AUDIT_KEY=... node tools/verify-audit-chain.mjs audit.ndjson [expectedFirstPrevHash] [expectedTipHash]
//
// Pin the TIP hash (recorded from the live gateway's /api/security/audit/anchor) to detect
// tail-truncation — dropping the most recent N events otherwise yields an internally-consistent
// prefix that verifies "OK".
//
// Exit code 0 = intact; 1 = broken (prints the first broken index + reason); 2 = usage error.
import fs from "node:fs";
import { createHmac } from "node:crypto";

const GENESIS = "0".repeat(64);

function master() {
  const key =
    process.env.AUDIT_KEY?.trim() ||
    process.env.PROVENANCE_KEY?.trim() ||
    process.env.BROKER_PSK?.trim() ||
    process.env.SESSION_SECRET?.trim();
  if (!key) {
    // Never fall back to a public dev master — that would validate a forgery sealed with the
    // well-known string and hand an operator false assurance. Refuse instead.
    console.error("verify-audit-chain: refusing to run without key material — set AUDIT_KEY (or PROVENANCE_KEY / BROKER_PSK / SESSION_SECRET).");
    process.exit(2);
  }
  return key;
}

function derivedKey(version) {
  return createHmac("sha256", master()).update(`audit:v${version}`).digest("hex");
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortDeep(value[k]);
    return out;
  }
  return value;
}
const canonical = (v) => JSON.stringify(sortDeep(v));

function linkHash(seq, prevHash, ev, version) {
  const { seal, ...bare } = ev;
  return createHmac("sha256", derivedKey(version)).update(`${seq}|${prevHash}|${canonical(bare)}`).digest("hex");
}

const [file, expectedFirstPrev = GENESIS, expectedTip] = process.argv.slice(2);
if (!file) { console.error("usage: verify-audit-chain.mjs <audit.ndjson> [expectedFirstPrevHash] [expectedTipHash]"); process.exit(2); }

const events = fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));

let prev = expectedFirstPrev;
let expectedSeq = null;
for (let i = 0; i < events.length; i++) {
  const ev = events[i];
  const seal = ev.seal;
  let reason = null;
  if (!seal) reason = "missing seal";
  else if (expectedSeq !== null && seal.seq !== expectedSeq) reason = "non-monotonic seq";
  else if (seal.prevHash !== prev) reason = "prevHash mismatch (event removed/reordered)";
  else if (linkHash(seal.seq, seal.prevHash, ev, seal.kv) !== seal.hash) reason = "hash mismatch (event altered)";
  if (reason) {
    console.error(`BROKEN at index ${i} (seq ${seal?.seq ?? "?"}): ${reason}`);
    process.exit(1);
  }
  prev = seal.hash;
  expectedSeq = seal.seq + 1;
}
if (expectedTip && prev !== expectedTip) {
  console.error(`BROKEN: chain tip ${prev} does not match the expected tip ${expectedTip} — events may have been truncated from the end.`);
  process.exit(1);
}
console.log(`OK — ${events.length} events form an intact chain; tip hash ${prev}`);
