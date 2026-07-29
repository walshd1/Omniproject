#!/usr/bin/env node
/**
 * Strict dependency audit — the CI `dependency-scan` gate. Blocks the build on any HIGH or CRITICAL advisory
 * affecting an installed package version; passes otherwise. Equivalent to `pnpm audit --audit-level high`,
 * but it works.
 *
 * Why this exists instead of `pnpm audit`: npm's bulk advisory endpoint
 * (registry.npmjs.org/-/npm/v1/security/advisories/bulk) returns a gzip-compressed body **without a
 * `Content-Encoding: gzip` response header**. pnpm/undici therefore never auto-decompress it and choke with
 * `ERR_PNPM_AUDIT_BAD_RESPONSE` ("… is not valid JSON") on EVERY pnpm version (verified 11.8.0 → 11.17.0).
 * The endpoint itself is healthy — `curl --compressed` decodes it fine. So we fetch it ourselves and gunzip
 * manually when the payload starts with the gzip magic bytes (0x1f 0x8b).
 *
 * Security posture: FAIL CLOSED. Any error (network, HTTP != 2xx, parse, missing semver) exits non-zero — the
 * gate never silently passes. Severity gating and semver range-matching mirror npm audit (using the `semver`
 * package, installed ephemerally by the CI step into NODE_PATH — never added to the workspace tree).
 */
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const ENDPOINT = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const BLOCK = new Set(["high", "critical"]);
const CHUNK = 200; // packages per request — keeps each POST small; ~4 requests for this repo

const require = createRequire(import.meta.url);
let semver;
try {
  semver = require("semver");
} catch {
  console.error("::error::audit-advisories: `semver` is not resolvable — the CI step must install it into NODE_PATH.");
  process.exit(1);
}

/** Flatten the whole installed workspace tree → Map(name → Set(versions)) from pnpm's own resolver output. */
function installedPackages() {
  const out = execFileSync("pnpm", ["ls", "-r", "--depth", "Infinity", "--json"], { maxBuffer: 1 << 28, encoding: "utf8" });
  const projects = JSON.parse(out);
  const map = new Map();
  const add = (name, version) => {
    if (!name || !version) return;
    let set = map.get(name);
    if (!set) { set = new Set(); map.set(name, set); }
    set.add(version);
  };
  const walk = (node) => {
    for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, info] of Object.entries(node[group] || {})) {
        if (info && typeof info === "object" && info.version) {
          add(name, info.version);
          if (info.dependencies) walk(info);
        }
      }
    }
  };
  for (const p of projects) walk(p);
  return map;
}

/** POST one chunk and return the advisories map (name → advisory[]), decoding the header-less gzip. */
async function fetchChunk(subBody) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "accept-encoding": "gzip" },
    body: JSON.stringify(subBody),
  });
  if (!res.ok) throw new Error(`advisory endpoint returned HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  return JSON.parse(text);
}

async function main() {
  const installed = installedPackages();
  const names = [...installed.keys()];
  const advisories = {};
  for (let i = 0; i < names.length; i += CHUNK) {
    const sub = {};
    for (const name of names.slice(i, i + CHUNK)) sub[name] = [...installed.get(name)];
    Object.assign(advisories, await fetchChunk(sub));
  }

  const violations = [];
  for (const [name, advs] of Object.entries(advisories)) {
    const versions = installed.get(name);
    if (!versions) continue;
    for (const a of advs) {
      if (!BLOCK.has(a.severity)) continue;
      const range = a.vulnerable_versions;
      const hit = [...versions].filter((v) => {
        try { return semver.satisfies(v, range); } catch { return false; }
      });
      if (hit.length) {
        violations.push({ name, hit, severity: a.severity, range, title: a.title, url: a.url, id: a.id ?? a.github_advisory_id ?? a.cves?.[0] });
      }
    }
  }

  if (violations.length) {
    console.error(`::error::dependency audit: ${violations.length} HIGH/CRITICAL advisory match(es) — build blocked.`);
    for (const v of violations.sort((x, y) => (x.severity < y.severity ? 1 : -1))) {
      console.error(` - ${v.severity.toUpperCase()}  ${v.name}@${v.hit.join(",")}  (vulnerable: ${v.range})  ${v.title ?? ""}  ${v.url ?? ""}`);
    }
    process.exit(1);
  }
  console.log(`dependency audit clean — scanned ${installed.size} distinct packages, no high/critical advisories affecting installed versions.`);
}

main().catch((err) => {
  // FAIL CLOSED — a transport/parse failure must never look like "no vulnerabilities".
  console.error(`::error::dependency audit could not complete: ${err?.message ?? err}`);
  process.exit(1);
});
