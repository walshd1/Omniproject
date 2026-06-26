import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { assertEgressAllowed, EgressError } from "./egress";

afterEach(() => delete process.env["EGRESS_ALLOWLIST"]);

test("blocks the cloud-metadata / link-local targets (the SSRF jackpot)", () => {
  for (const u of [
    "http://169.254.169.254/latest/meta-data/iam/",
    "http://169.254.170.2/v2/credentials",
    "https://metadata.google.internal/computeMetadata/v1/",
    "http://[fd00:ec2::254]/latest/",
    "http://[fe80::1]/",
  ]) {
    assert.throws(() => assertEgressAllowed(u), EgressError, `should block ${u}`);
  }
});

test("blocks non-http(s) schemes", () => {
  assert.throws(() => assertEgressAllowed("file:///etc/passwd"), EgressError);
  assert.throws(() => assertEgressAllowed("gopher://x/"), EgressError);
  assert.throws(() => assertEgressAllowed("not a url"), EgressError);
});

test("allows ordinary internal + external hosts by default (deployments need this)", () => {
  // The broker legitimately lives on the internal network / localhost.
  assert.ok(assertEgressAllowed("http://n8n:5678/webhook/omniproject"));
  assert.ok(assertEgressAllowed("http://localhost:5678/webhook"));
  assert.ok(assertEgressAllowed("http://10.0.0.5:5678/"));
  assert.ok(assertEgressAllowed("https://api.example.com/fx"));
});

test("strict mode: EGRESS_ALLOWLIST pins outbound hosts", () => {
  process.env["EGRESS_ALLOWLIST"] = "n8n,idp.example.com";
  assert.ok(assertEgressAllowed("http://n8n:5678/webhook"));
  assert.ok(assertEgressAllowed("https://idp.example.com/token"));
  assert.throws(() => assertEgressAllowed("https://evil.example.com/"), EgressError);
  // …and the metadata block still applies even inside an allowlist.
  assert.throws(() => assertEgressAllowed("http://169.254.169.254/"), EgressError);
});
