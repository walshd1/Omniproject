import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { assertEgressAllowed, EgressError, type LookupFn } from "./egress";
import { DataResidencyError } from "./data-residency";

afterEach(() => { delete process.env["EGRESS_ALLOWLIST"]; delete process.env["DATA_RESIDENCY_POLICY"]; });

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
