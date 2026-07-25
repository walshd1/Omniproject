import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit coverage for the update-time validation branches in lib/settings.ts that the HTTP
 * route tests don't reach: the `dashboards[]` element/widget shape guards. (The `loggingSync`
 * egress guards moved to `sanitizeLoggingSync` — see below — with the `logging-sync` config def.)
 * `updateSettings` runs the same `validatePatch` the PATCH /settings path does,
 * and rejects a bad patch ATOMICALLY (it throws before writing anything to the store), so these
 * invalid-patch calls never mutate global settings — the afterEach reset is defensive only.
 */
process.env["SESSION_SECRET"] ??= "test-settings-validation-secret";
process.env["NODE_ENV"] ??= "production";
process.env["SECURITY_STRICT"] ??= "off";

const settings = await import("../lib/settings");
const { updateSettings, SettingsValidationError, getSettings, redactSettingsForRead } = settings;
const { sanitizeLoggingSync } = await import("../lib/logging-sync");

afterEach(() => {
  // Nothing above mutates (invalid patches throw pre-write), but reset a touched key to its default
  // so this file can never leak state into another suite in the shared process.
  updateSettings({ reportOverrides: [] });
});

const rejects = (patch: Record<string, unknown>, re: RegExp) =>
  assert.throws(() => updateSettings(patch), (err: unknown) => err instanceof SettingsValidationError && re.test(err.message));

// ── loggingSync egress guards — now sanitizeLoggingSync (lib/logging-sync), the `logging-sync` config def ──
const rejectsSync = (value: unknown, re: RegExp) =>
  assert.throws(() => sanitizeLoggingSync(value), (err: unknown) => err instanceof SettingsValidationError && re.test((err as Error).message));

test("loggingSync: a link-local/metadata url is rejected via the outbound-URL safety check", () => {
  rejectsSync({ url: "http://169.254.169.254/latest/meta-data" }, /link-local|metadata|invalid/i);
});

test("loggingSync: enabling with no url is rejected (enable requires a url)", () => {
  rejectsSync({ enabled: true }, /requires a url/);
});

test("loggingSync: enabling with a url but no warranty acknowledgement is rejected", () => {
  rejectsSync({ enabled: true, url: "https://logs.example.com/ingest" }, /warranty/);
});

test("loggingSync: a valid enable normalises to the clean config object", () => {
  assert.deepEqual(
    sanitizeLoggingSync({ enabled: true, url: "https://logs.example.com/ingest", acknowledgedWarranty: true }),
    { enabled: true, url: "https://logs.example.com/ingest", acknowledgedWarranty: true },
  );
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
