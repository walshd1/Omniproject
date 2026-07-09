import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { updateSettings, getSettings, redactSettingsForRead, SettingsValidationError } from "./settings";

/**
 * Settings patch validation — updateSettings runs an untrusted patch through validatePatch,
 * rejecting the first bad field with a SettingsValidationError (so the route answers 400 and
 * nothing persists). These exercise the per-field guards not covered by the happy-path suite.
 */
const throws = (patch: Record<string, unknown>) =>
  assert.throws(() => updateSettings(patch), SettingsValidationError);

afterEach(() => {
  // Reset any fields a successful case may have written.
  updateSettings({
    webhooks: [], federatedPeers: [], disabledFeatures: [], enabledFeatures: [], hiddenFields: [],
    savedViews: [], labelOverrides: {}, branding: null, reportingCurrency: null, fxRateAsOfDate: null,
    fxRatePolicy: "spot", fieldOverrides: { fields: {}, entities: {} },
  });
});

test("scalar enums: aiProvider / sttProvider / deploymentProfile / fxRatePolicy", () => {
  throws({ aiProvider: "not-a-provider" });
  throws({ sttProvider: "telepathy" });
  throws({ deploymentProfile: "spaceship" });
  throws({ fxRatePolicy: "guesswork" });
  // A null deploymentProfile is allowed (clears it) — must NOT throw.
  assert.doesNotThrow(() => updateSettings({ deploymentProfile: null }));
});

test("reportingCurrency must be a 3-letter code (or null); normalises to upper-case", () => {
  throws({ reportingCurrency: "EURO" });
  throws({ reportingCurrency: 123 });
  assert.equal(updateSettings({ reportingCurrency: "gbp" }).reportingCurrency, "GBP");
  assert.equal(updateSettings({ reportingCurrency: "" }).reportingCurrency, null); // empty → cleared
});

test("fxRateAsOfDate must be an ISO date string (or null/empty to clear)", () => {
  throws({ fxRateAsOfDate: "not-a-date" });
  throws({ fxRateAsOfDate: 20240101 });
  assert.equal(updateSettings({ fxRateAsOfDate: "2024-01-01" }).fxRateAsOfDate, "2024-01-01");
  assert.equal(updateSettings({ fxRateAsOfDate: "" }).fxRateAsOfDate, null);
});

test("brokerUrl / oidcIssuerUrl must be safe outbound URLs or null", () => {
  throws({ brokerUrl: 42 });
  throws({ brokerUrl: "http://169.254.169.254/latest" }); // link-local metadata → unsafe
  throws({ oidcIssuerUrl: "not a url" }); // malformed → unsafe
  assert.doesNotThrow(() => updateSettings({ brokerUrl: null }));
});

test("webhooks: array of objects each with a safe url", () => {
  throws({ webhooks: "nope" });
  throws({ webhooks: [null] });
  throws({ webhooks: [{ noUrl: true }] });
  throws({ webhooks: [{ url: "http://169.254.169.254/x" }] }); // unsafe metadata target
  assert.doesNotThrow(() => updateSettings({ webhooks: [{ id: "w", url: "https://example.com/hook", secret: "s", events: ["*"], active: true }] }));
});

test("federatedPeers: id/label/baseUrl/token/region/active are all validated", () => {
  throws({ federatedPeers: "nope" });
  throws({ federatedPeers: [null] });
  throws({ federatedPeers: [{ label: "no id" }] });
  throws({ federatedPeers: [{ id: "p" }] }); // no label
  throws({ federatedPeers: [{ id: "p", label: "L" }] }); // no baseUrl
  throws({ federatedPeers: [{ id: "p", label: "L", baseUrl: "http://169.254.169.254" }] }); // unsafe
  throws({ federatedPeers: [{ id: "p", label: "L", baseUrl: "https://peer.example.com" }] }); // no token
  throws({ federatedPeers: [{ id: "p", label: "L", baseUrl: "https://peer.example.com", token: "t", region: 5 }] }); // bad region
  throws({ federatedPeers: [{ id: "p", label: "L", baseUrl: "https://peer.example.com", token: "t", active: "yes" }] }); // bad active
  assert.doesNotThrow(() => updateSettings({ federatedPeers: [{ id: "p", label: "L", baseUrl: "https://peer.example.com", token: "t", region: "eu", active: true }] }));
});

test("branding / labelOverrides object shape", () => {
  throws({ branding: "not-an-object" });
  throws({ labelOverrides: "not-an-object" });
  throws({ labelOverrides: null });
  assert.doesNotThrow(() => updateSettings({ branding: null }));
  assert.doesNotThrow(() => updateSettings({ labelOverrides: { status: "Stage" } }));
});

test("string-array fields: disabledFeatures / enabledFeatures / hiddenFields", () => {
  throws({ disabledFeatures: "odata" });
  throws({ disabledFeatures: [1, 2] });
  throws({ enabledFeatures: [true] });
  throws({ hiddenFields: { a: 1 } });
  assert.doesNotThrow(() => updateSettings({ disabledFeatures: ["odata"], enabledFeatures: ["labels"], hiddenFields: ["budget"] }));
});

test("featureGovernance / scope feature maps / governanceRules shapes", () => {
  throws({ featureGovernance: "nope" });
  throws({ featureGovernance: { required: [1] } });
  throws({ programmeFeatures: [] }); // must be an object keyed by id
  throws({ programmeFeatures: { prog1: "nope" } });
  throws({ programmeFeatures: { prog1: { disabled: "no" } } });
  throws({ projectFeatures: { p1: { required: [5] } } });
  throws({ governanceRules: "nope" });
  throws({ governanceRules: [{ noId: true }] });
  throws({ governanceRules: [{ id: "r", require: [1] }] });
  assert.doesNotThrow(() => updateSettings({ featureGovernance: { required: ["labels"], forbidden: [] }, governanceRules: [{ id: "r", require: ["labels"] }] }));
});

test("savedViews entries need string id + name", () => {
  throws({ savedViews: "nope" });
  throws({ savedViews: [null] });
  throws({ savedViews: [{ name: "no id" }] });
  throws({ savedViews: [{ id: "v" }] }); // no name
  assert.doesNotThrow(() => updateSettings({ savedViews: [{ id: "v", name: "My view" }] }));
});

test("fieldOverrides support-map validation", () => {
  throws({ fieldOverrides: "nope" });
  throws({ fieldOverrides: { fields: "nope" } });
  throws({ fieldOverrides: { fields: { budget: "nope" } } });
  throws({ fieldOverrides: { fields: { budget: { surface: true } } } }); // store missing
  throws({ fieldOverrides: { entities: { issue: { surface: "yes", store: true } } } }); // non-boolean
  assert.doesNotThrow(() => updateSettings({ fieldOverrides: { fields: { budget: { surface: true, store: false } }, entities: {} } }));
});

test("loggingSync: object with a safe url; enabling needs url + warranty ack", () => {
  throws({ loggingSync: "nope" });
  throws({ loggingSync: { url: 5 } });
  throws({ loggingSync: { url: "http://169.254.169.254/logs" } }); // unsafe
  throws({ loggingSync: { enabled: true, url: "", acknowledgedWarranty: true } }); // no url
  throws({ loggingSync: { enabled: true, url: "https://logs.example.com", acknowledgedWarranty: false } }); // no ack
  assert.doesNotThrow(() => updateSettings({ loggingSync: { enabled: true, url: "https://logs.example.com", acknowledgedWarranty: true } }));
  // Reset the sync back off so it doesn't leak into other tests.
  updateSettings({ loggingSync: { enabled: false, url: null, acknowledgedWarranty: false } });
});

test("selfHost: valid mode + string[] adopted; a non-off mode needs the data-responsibility ack", () => {
  throws({ selfHost: "nope" });
  throws({ selfHost: { mode: "bogus", adopted: [], acknowledgedDataResponsibility: false } }); // bad mode
  throws({ selfHost: { mode: "off", adopted: [1], acknowledgedDataResponsibility: false } }); // non-string id
  throws({ selfHost: { mode: "off", adopted: [], acknowledgedDataResponsibility: "yes" } }); // non-boolean ack
  throws({ selfHost: { mode: "system-of-record", adopted: ["financials"], acknowledgedDataResponsibility: false } }); // no ack
  assert.doesNotThrow(() => updateSettings({ selfHost: { mode: "augmenting", adopted: ["quality"], acknowledgedDataResponsibility: true } }));
  // Reset back off so it doesn't leak into other tests.
  updateSettings({ selfHost: { mode: "off", adopted: [], acknowledgedDataResponsibility: false } });
});

test("historyRetention: valid org-default + scope cadence maps; bad cadences rejected", () => {
  throws({ historyRetention: "nope" });
  throws({ historyRetention: { orgDefault: { kind: "bogus" } } });
  throws({ historyRetention: { orgDefault: { kind: "interval", everyHours: 0 } } });
  throws({ historyRetention: { orgDefault: { kind: "onWrite" }, programme: { P1: { kind: "interval", everyHours: -1 } } } });
  assert.doesNotThrow(() => updateSettings({ historyRetention: { orgDefault: { kind: "interval", everyHours: 12 }, programme: { P1: { kind: "onWrite" } }, project: {} } }));
  // Reset back to the default so it doesn't leak into other tests.
  updateSettings({ historyRetention: { orgDefault: { kind: "interval", everyHours: 24 }, programme: {}, project: {} } });
});

test("redactSettingsForRead masks webhook secrets and peer tokens", () => {
  updateSettings({
    webhooks: [{ id: "w", url: "https://example.com/h", secret: "topsecret", events: ["*"], active: true }],
    federatedPeers: [{ id: "p", label: "L", baseUrl: "https://peer.example.com", token: "peertoken", region: "eu", active: true }],
  });
  const red = redactSettingsForRead(getSettings());
  assert.equal(red.webhooks[0]!.secret, "********");
  assert.equal(red.federatedPeers![0]!.token, "********");
  // A webhook without a secret masks to empty string, not the placeholder.
  const red2 = redactSettingsForRead({ ...getSettings(), webhooks: [{ id: "w2", url: "https://x/y", secret: "", events: ["*"], active: true }], federatedPeers: [] });
  assert.equal(red2.webhooks[0]!.secret, "");
});
