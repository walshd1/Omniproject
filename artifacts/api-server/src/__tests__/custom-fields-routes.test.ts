import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for admin-defined custom fields + the source rule: a custom field must be mapped in
 * the routing matrix OR held by the built-in backend, else the PUT is a 400 (no data source).
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ customFields: [], fieldRouting: [] });
  delete process.env["BUILTIN_BROKER"];
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();
const field = { key: "riskAppetite", label: "Risk appetite", type: "string" };

test("GET /custom-fields defaults to []", async () => {
  const r = await h.req("/custom-fields", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).customFields, []);
});

test("an unmapped custom field with no built-in backend is a 400 (no data source)", async () => {
  const r = await h.req("/custom-fields", { method: "PUT", cookie: adminCookie(), body: { customFields: [field] } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /no data source/i);
});

test("a MAPPED custom field is accepted", async () => {
  // First map riskAppetite in the routing matrix, then add the custom field.
  await h.req("/routing", { method: "PUT", cookie: adminCookie(), body: { fieldRouting: [{ uiElement: "riskAppetite", vendor: "jira", broker: "n8n", sourceField: "cf_1" }] } });
  const r = await h.req("/custom-fields", { method: "PUT", cookie: adminCookie(), body: { customFields: [field] } });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).customFields, [field]);
});

test("an UNMAPPED custom field is accepted when the built-in backend is enabled (it holds it)", async () => {
  process.env["BUILTIN_BROKER"] = "1";
  const r = await h.req("/custom-fields", { method: "PUT", cookie: adminCookie(), body: { customFields: [field] } });
  assert.equal(r.status, 200);
});
