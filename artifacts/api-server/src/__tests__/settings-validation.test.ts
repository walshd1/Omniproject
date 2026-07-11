import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit coverage for the update-time validation branches in lib/settings.ts that the HTTP
 * route tests don't reach: the `dashboards[]` element/widget shape guards and the `loggingSync`
 * egress guards. `updateSettings` runs the same `validatePatch` the PATCH /settings path does,
 * and rejects a bad patch ATOMICALLY (it throws before writing anything to the store), so these
 * invalid-patch calls never mutate global settings — the afterEach reset is defensive only.
 */
process.env["SESSION_SECRET"] ??= "test-settings-validation-secret";
process.env["NODE_ENV"] ??= "production";
process.env["SECURITY_STRICT"] ??= "off";

const settings = await import("../lib/settings");
const { updateSettings, SettingsValidationError, getSettings, redactSettingsForRead } = settings;

afterEach(() => {
  // Nothing above mutates (invalid patches throw pre-write), but reset the touched keys to
  // their defaults so this file can never leak state into another suite in the shared process.
  updateSettings({ dashboards: [], loggingSync: { enabled: false, url: null, acknowledgedWarranty: false } });
});

const rejects = (patch: Record<string, unknown>, re: RegExp) =>
  assert.throws(() => updateSettings(patch), (err: unknown) => err instanceof SettingsValidationError && re.test(err.message));

// ── dashboards[] element shape (settings.ts ~896/899) ─────────────────────────────
test("dashboards: a null element is rejected (each dashboard must be an object)", () => {
  rejects({ dashboards: [null] }, /each dashboard must be an object/);
});

test("dashboards: a non-object (string) element is rejected — the typeof arm of the guard", () => {
  rejects({ dashboards: ["not-a-dashboard"] }, /each dashboard must be an object/);
});

test("dashboards: a non-string id is rejected (each dashboard needs a string id)", () => {
  rejects({ dashboards: [{ id: 42, name: "Exec" }] }, /each dashboard needs a string id/);
});

test("dashboards: an empty-string name is rejected — the falsy-name arm of the guard", () => {
  rejects({ dashboards: [{ id: "d1", name: "" }] }, /each dashboard needs a name/);
});

test("dashboards: a missing name is rejected — the non-string arm of the guard", () => {
  rejects({ dashboards: [{ id: "d1" }] }, /each dashboard needs a name/);
});

test("dashboards: a negative refreshMs is rejected", () => {
  rejects({ dashboards: [{ id: "d1", name: "Exec", refreshMs: -5, widgets: [] }] }, /refreshMs must be a non-negative number/);
});

test("dashboards: a missing widgets array is rejected", () => {
  rejects({ dashboards: [{ id: "d1", name: "Exec" }] }, /needs a widgets array/);
});

// ── dashboards[].widgets[] element shape (settings.ts ~904) ───────────────────────
test("dashboards: a null widget is rejected (each dashboard widget must be an object)", () => {
  rejects({ dashboards: [{ id: "d1", name: "Exec", widgets: [null] }] }, /each dashboard widget must be an object/);
});

test("dashboards: a non-object (string) widget is rejected — the typeof arm of the widget guard", () => {
  rejects({ dashboards: [{ id: "d1", name: "Exec", widgets: ["not-a-widget"] }] }, /each dashboard widget must be an object/);
});

// ── loggingSync egress guards (settings.ts ~921/927) ──────────────────────────────
test("loggingSync: a link-local/metadata url is rejected via the outbound-URL safety check", () => {
  // assertSafeOutboundUrl throws UnsafeUrlError → caught and re-thrown as a settings error.
  rejects({ loggingSync: { url: "http://169.254.169.254/latest/meta-data" } }, /link-local|metadata|invalid/i);
});

test("loggingSync: enabling with no url is rejected (enable requires a url)", () => {
  rejects({ loggingSync: { enabled: true } }, /requires a url/);
});

test("loggingSync: enabling with a url but no warranty acknowledgement is rejected", () => {
  rejects({ loggingSync: { enabled: true, url: "https://logs.example.com/ingest" } }, /warranty/);
});

// ── customReports shape (settings.ts validateCustomReports ~715/718/719/722/728/729) ──
const REPORT = { id: "c1", label: "Cost", scope: "project", viz: "table", metrics: [{ id: "m1", field: "cost", agg: "sum" }] };
test("customReports: a non-array payload is rejected", () => {
  rejects({ customReports: "nope" }, /customReports must be an array/);
});
test("customReports: an element without a string id is rejected", () => {
  rejects({ customReports: [{ label: "no id" }] }, /needs a string id/);
});
test("customReports: an element without a label is rejected", () => {
  rejects({ customReports: [{ id: "c1" }] }, /needs a label/);
});
test("customReports: a non-string groupBy is rejected", () => {
  rejects({ customReports: [{ ...REPORT, groupBy: 5 }] }, /groupBy must be a string/);
});
test("customReports: a metric without a string id is rejected", () => {
  rejects({ customReports: [{ ...REPORT, metrics: [{ field: "cost", agg: "sum" }] }] }, /metric needs a string id/);
});
test("customReports: a metric without a field is rejected", () => {
  rejects({ customReports: [{ ...REPORT, metrics: [{ id: "m1", agg: "sum" }] }] }, /metric needs a field/);
});

// ── reportOverrides shape (settings.ts validateReportOverrides ~752/756) ──────────
test("reportOverrides: a non-array payload is rejected", () => {
  rejects({ reportOverrides: "nope" }, /reportOverrides must be an array/);
});
test("reportOverrides: a non-string label is rejected", () => {
  rejects({ reportOverrides: [{ id: "evm", label: 7 }] }, /label must be a string/);
});

// ── redactSettingsForRead masks peer tokens + tolerates a missing list (settings.ts ~639) ──
test("redactSettingsForRead tolerates an absent federatedPeers list (defaults to [])", () => {
  const masked = redactSettingsForRead({ ...getSettings(), federatedPeers: undefined as never });
  assert.deepEqual(masked.federatedPeers, []);
});

test("redactSettingsForRead masks a peer's real token but leaves an empty one empty", () => {
  const peers = [
    { id: "p1", label: "P1", baseUrl: "https://a.example.com", token: "supersecret", region: null },
    { id: "p2", label: "P2", baseUrl: "https://b.example.com", token: "", region: null },
  ];
  const masked = redactSettingsForRead({ ...getSettings(), federatedPeers: peers as never });
  assert.equal(masked.federatedPeers![0]!.token, "********"); // non-empty ⇒ masked
  assert.equal(masked.federatedPeers![1]!.token, ""); // empty ⇒ stays empty
});
