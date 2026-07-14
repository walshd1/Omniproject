import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { assertEgressAllowed, safeFetch, guardedLookup, __setEgressTransportForTest, EgressError, type LookupFn } from "./egress";
import { DataResidencyError } from "./data-residency";

afterEach(() => { delete process.env["EGRESS_ALLOWLIST"]; delete process.env["DATA_RESIDENCY_POLICY"]; __setEgressTransportForTest(null); });

/** A deterministic fake `dns.lookup` — every test that touches a plain (non-IP-literal)
 *  hostname must supply one, so nothing here depends on real network/DNS availability. */
function fakeLookup(table: Record<string, { address: string; family: number }[]>): LookupFn {
  return async (hostname) => {
    const rows = table[hostname];
    if (!rows) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    return rows;
  };
}
const SAFE = fakeLookup({
  n8n: [{ address: "10.0.0.5", family: 4 }],
  "idp.example.com": [{ address: "93.184.216.34", family: 4 }],
  "api.example.com": [{ address: "93.184.216.34", family: 4 }],
  "api.eu.example.com": [{ address: "93.184.216.34", family: 4 }],
});

test("blocks the cloud-metadata / link-local targets by literal IP (the SSRF jackpot)", async () => {
  for (const u of [
    "http://169.254.169.254/latest/meta-data/iam/",
    "http://169.254.170.2/v2/credentials",
    "https://metadata.google.internal/computeMetadata/v1/",
    "http://[fd00:ec2::254]/latest/",
    "http://[fe80::1]/",
  ]) {
    await assert.rejects(assertEgressAllowed(u), EgressError, `should block ${u}`);
  }
});

test("blocks an IPv4-mapped IPv6 literal of the metadata address (the previously-missed bypass)", async () => {
  await assert.rejects(assertEgressAllowed("http://[::ffff:a9fe:a9fe]/latest/"), EgressError);
  await assert.rejects(assertEgressAllowed("http://[::ffff:169.254.169.254]/"), EgressError);
});

test("blocks non-http(s) schemes", async () => {
  await assert.rejects(assertEgressAllowed("file:///etc/passwd"), EgressError);
  await assert.rejects(assertEgressAllowed("gopher://x/"), EgressError);
  await assert.rejects(assertEgressAllowed("not a url"), EgressError);
});

test("blocks a plain hostname that RESOLVES to the metadata address (the DNS bypass this guard used to miss entirely)", async () => {
  const lookup = fakeLookup({ "evil.attacker.example": [{ address: "169.254.169.254", family: 4 }] });
  await assert.rejects(assertEgressAllowed("http://evil.attacker.example/steal", lookup), EgressError);
});

test("blocks a hostname that resolves to the metadata address via IPv6 only", async () => {
  const lookup = fakeLookup({ "evil6.attacker.example": [{ address: "fe80::1", family: 6 }] });
  await assert.rejects(assertEgressAllowed("http://evil6.attacker.example/", lookup), EgressError);
});

test("blocks when ANY resolved address is unsafe, even if another is fine (multi-A-record attack)", async () => {
  const lookup = fakeLookup({
    "multi.attacker.example": [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ],
  });
  await assert.rejects(assertEgressAllowed("http://multi.attacker.example/", lookup), EgressError);
});

test("fails closed when DNS resolution errors (can't confirm safety ⇒ refuse)", async () => {
  const lookup = fakeLookup({}); // no entries ⇒ every lookup throws ENOTFOUND
  await assert.rejects(assertEgressAllowed("http://does-not-resolve.invalid/", lookup), EgressError);
});

test("allows ordinary internal + external hosts by default (deployments need this)", async () => {
  // The broker legitimately lives on the internal network / localhost.
  assert.ok(await assertEgressAllowed("http://n8n:5678/webhook/omniproject", SAFE));
  assert.ok(await assertEgressAllowed("http://localhost:5678/webhook")); // real loopback resolution — always safe
  assert.ok(await assertEgressAllowed("http://10.0.0.5:5678/")); // literal IP — no DNS lookup at all
  assert.ok(await assertEgressAllowed("https://api.example.com/fx", SAFE));
});

test("strict mode: EGRESS_ALLOWLIST pins outbound hosts", async () => {
  process.env["EGRESS_ALLOWLIST"] = "n8n,idp.example.com";
  assert.ok(await assertEgressAllowed("http://n8n:5678/webhook", SAFE));
  assert.ok(await assertEgressAllowed("https://idp.example.com/token", SAFE));
  const lookup = fakeLookup({ "evil.example.com": [{ address: "93.184.216.34", family: 4 }] });
  await assert.rejects(assertEgressAllowed("https://evil.example.com/", lookup), EgressError);
  // …and the metadata block still applies even inside an allowlist.
  await assert.rejects(assertEgressAllowed("http://169.254.169.254/"), EgressError);
});

test("per-country residency policy gates egress at the seam (fail-closed on a foreign host)", async () => {
  process.env["DATA_RESIDENCY_POLICY"] = JSON.stringify({
    regions: {
      eu: { backends: ["https://eu.n8n.example"], egress: ["*.eu.example.com"] },
      us: { backends: ["https://us.n8n.example"], egress: ["*.us.example.com"] },
    },
    allowed: ["eu"],
  });
  const lookup = fakeLookup({
    "api.eu.example.com": [{ address: "93.184.216.34", family: 4 }],
    "eu.n8n.example": [{ address: "93.184.216.34", family: 4 }],
    "api.us.example.com": [{ address: "93.184.216.34", family: 4 }],
    "evil.example.net": [{ address: "93.184.216.34", family: 4 }],
  });
  // An allowed-region egress host + the region's own backend pass.
  assert.ok(await assertEgressAllowed("https://api.eu.example.com/x", lookup));
  assert.ok(await assertEgressAllowed("https://eu.n8n.example/webhook", lookup));
  // A non-allowed region and a foreign host are refused with a 451 DataResidencyError.
  await assert.rejects(assertEgressAllowed("https://api.us.example.com/x", lookup), DataResidencyError);
  await assert.rejects(assertEgressAllowed("https://evil.example.net/", lookup), DataResidencyError);
  // The metadata/link-local block still fires first (defence in depth).
  await assert.rejects(assertEgressAllowed("http://169.254.169.254/"), EgressError);
});

test("safeFetch pins the connection to the VALIDATED address (reaches the vetted IP, not live DNS)", async () => {
  const http = await import("node:http");
  const { safeFetch } = await import("./egress");
  const server = http.createServer((_req, res) => { res.writeHead(200); res.end("pinned-ok"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    // "vetted.internal" is not a real DNS name — only the injected lookup resolves it (to loopback).
    // If safeFetch re-resolved via live DNS it would ENOTFOUND; reaching the server proves it pinned.
    const lookup: LookupFn = async (h) => {
      if (h === "vetted.internal") return [{ address: "127.0.0.1", family: 4 }];
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    };
    const res = await safeFetch(`http://vetted.internal:${port}/`, {}, lookup);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "pinned-ok");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("safeFetch follows redirects but RE-VALIDATES each hop — a 302 to the metadata IP is blocked (SSRF-redirect bypass)", async () => {
  // A benign, allowed first host 302s the gateway straight at the cloud-metadata endpoint. undici's
  // built-in redirect following would connect there unchecked; safeFetch must re-run the guard.
  __setEgressTransportForTest(async () =>
    new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/iam/" } }));
  await assert.rejects(safeFetch("http://api.example.com/go", undefined, SAFE), EgressError);
});

test("safeFetch follows a redirect chain to an ALLOWED host through to the final response", async () => {
  let calls = 0;
  __setEgressTransportForTest(async () => {
    calls += 1;
    if (calls === 1) return new Response(null, { status: 302, headers: { location: "http://api.eu.example.com/final" } });
    return new Response("ok", { status: 200 });
  });
  const r = await safeFetch("http://api.example.com/start", undefined, SAFE);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "ok");
  assert.equal(calls, 2); // followed exactly one hop
});

test("safeFetch refuses a redirect loop rather than following forever", async () => {
  __setEgressTransportForTest(async () =>
    new Response(null, { status: 302, headers: { location: "http://api.example.com/loop" } }));
  await assert.rejects(safeFetch("http://api.example.com/loop", undefined, SAFE), EgressError);
});

// ── guardedLookup: the connect-time validator that pins a persistent dispatcher (broker Agent) ──
/** Drive guardedLookup and resolve with its callback args. */
function callGuarded(host: string, all: boolean): Promise<{ err: Error | null; address: unknown; family: number | undefined }> {
  return new Promise((resolve) => {
    guardedLookup(host, { all }, (err, address, family) => resolve({ err, address, family }));
  });
}

test("guardedLookup passes a safe IP literal through (single + all forms)", async () => {
  const single = await callGuarded("127.0.0.1", false);
  assert.equal(single.err, null);
  assert.equal(single.address, "127.0.0.1");
  assert.equal(single.family, 4);
  const all = await callGuarded("127.0.0.1", true);
  assert.equal(all.err, null);
  assert.deepEqual(all.address, [{ address: "127.0.0.1", family: 4 }]);
});

test("guardedLookup REFUSES a link-local/metadata IP literal (the SSRF target)", async () => {
  const r = await callGuarded("169.254.169.254", false);
  assert.ok(r.err instanceof EgressError, "expected an EgressError for the metadata IP");
  assert.match(r.err.message, /blocked/i);
});

test("guardedLookup REFUSES a metadata hostname without needing DNS", async () => {
  const r = await callGuarded("metadata.google.internal", false);
  assert.ok(r.err instanceof EgressError);
  assert.match(r.err.message, /blocked/i);
});

test("guardedLookup resolves a normal name and returns validated addresses (localhost path)", async () => {
  const r = await callGuarded("localhost", true);
  assert.equal(r.err, null);
  assert.ok(Array.isArray(r.address) && (r.address as unknown[]).length > 0, "localhost should resolve to ≥1 vetted address");
});
