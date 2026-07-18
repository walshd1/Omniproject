import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/ai-allowlist.ts + the PATCH /settings selection gate over the REAL app — the AI provider allowlist
 * FLOOR (roadmap Phase C). GET is any-authed; PUT sets the org ceiling (admin). Once an allowlist is set, a
 * PATCH /settings that selects a provider OUTSIDE it is rejected (400); "none" is always allowed; an
 * unrestricted (null) allowlist permits everything.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ai-allowlist-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });
afterEach(async () => {
  const { writeOrgAiProviderAllowlist } = await import("../lib/ai-allowlist");
  writeOrgAiProviderAllowlist(null); // back to unrestricted
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ aiProvider: "none" });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();
const setProvider = (aiProvider: string) => h.req("/settings", { method: "PATCH", cookie: adminCookie(), body: { aiProvider } });

test("GET without a cookie → 401", async () => {
  assert.equal((await h.req("/ai/provider-allowlist")).status, 401);
});

test("GET defaults to null (unrestricted) when nothing is stored", async () => {
  const r = await h.req("/ai/provider-allowlist", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.equal((await json(r)).aiProviderAllowlist, null);
});

test("PUT sets the org ceiling and round-trips", async () => {
  const put = await h.req("/ai/provider-allowlist", { method: "PUT", cookie: adminCookie(), body: { aiProviderAllowlist: ["openai", "anthropic"] } });
  assert.equal(put.status, 200);
  assert.deepEqual((await json(put)).aiProviderAllowlist, ["openai", "anthropic"]);
});

test("PUT a malformed value → 400", async () => {
  const bad = await h.req("/ai/provider-allowlist", { method: "PUT", cookie: adminCookie(), body: { aiProviderAllowlist: [1, 2] } });
  assert.equal(bad.status, 400);
  assert.match((await json(bad)).error, /null or an array/i);
});

test("PATCH /settings selecting a FORBIDDEN provider is rejected (400); an allowed one and \"none\" pass", async () => {
  await h.req("/ai/provider-allowlist", { method: "PUT", cookie: adminCookie(), body: { aiProviderAllowlist: ["anthropic"] } });

  // A provider outside the allowlist → 400.
  const forbidden = await setProvider("openai");
  assert.equal(forbidden.status, 400);
  assert.match((await json(forbidden)).error, /not permitted by this deployment's AI provider allowlist/i);

  // An allowed provider passes.
  assert.notEqual((await setProvider("anthropic")).status, 400);
  // "none" (AI off) is always allowed, even under a restrictive allowlist.
  assert.notEqual((await setProvider("none")).status, 400);
});

test("an unrestricted (null) allowlist permits any provider", async () => {
  const { writeOrgAiProviderAllowlist } = await import("../lib/ai-allowlist");
  writeOrgAiProviderAllowlist(null);
  assert.notEqual((await setProvider("openai")).status, 400);
});
