import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { updateSettings, getSettings, redactSettingsForRead, SettingsValidationError, validateSavedViews } from "./settings";
import { sanitizeLoggingSync } from "./logging-sync";

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
    fxRatePolicy: "spot", fieldOverrides: { fields: {}, entities: {} }, digestDelivery: { emailRecipients: [] },
  });
});

test("digestDelivery.emailRecipients must be a bounded array of valid email addresses", () => {
  throws({ digestDelivery: "nope" });
  throws({ digestDelivery: { emailRecipients: "a@x.io" } }); // string, not array
  throws({ digestDelivery: { emailRecipients: [123] } }); // non-string entry
  throws({ digestDelivery: { emailRecipients: ["not-an-email"] } }); // fails the x@y.z shape check
  throws({ digestDelivery: { emailRecipients: Array.from({ length: 101 }, (_, i) => `u${i}@x.io`) } }); // over the cap
  assert.deepEqual(
    updateSettings({ digestDelivery: { emailRecipients: ["pm@x.io", "pgm@team.example"] } }).digestDelivery.emailRecipients,
    ["pm@x.io", "pgm@team.example"],
  );
  assert.doesNotThrow(() => updateSettings({ digestDelivery: { emailRecipients: [] } })); // empty = delivery off
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

// NB branding + labelOverrides are no longer settings keys (they're `branding`/`label-overrides` config defs) —
// the bulk PATCH can't set them, so there's nothing to validate here. Their shape guards (sanitizeBranding /
// sanitizeLabels) are exercised in premium-config.test, on both the write and the defensive-read paths.

test("string-array fields: disabledFeatures / enabledFeatures", () => {
  // NB hiddenFields is no longer a settings key (config-def-backed `hidden-fields`); its sanitiser is tested
  // via the availability-curation route.
  throws({ disabledFeatures: "odata" });
  throws({ disabledFeatures: [1, 2] });
  throws({ enabledFeatures: [true] });
  assert.doesNotThrow(() => updateSettings({ disabledFeatures: ["odata"], enabledFeatures: ["labels"] }));
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

// savedViews is a config def now (routes/views); its validator is exercised directly.
test("savedViews entries need string id + name", () => {
  assert.throws(() => validateSavedViews("nope"), SettingsValidationError);
  assert.throws(() => validateSavedViews([null]), SettingsValidationError);
  assert.throws(() => validateSavedViews([{ name: "no id" }]), SettingsValidationError);
  assert.throws(() => validateSavedViews([{ id: "v" }]), SettingsValidationError); // no name
  assert.doesNotThrow(() => validateSavedViews([{ id: "v", name: "My view" }]));
});

// NB methodologyComposition is no longer a settings key (it's a nullable `methodology-composition` config def);
// its null/array validation is exercised in the methodology-composition route test.

test("artifact style: enums for font/align, capped colour + title strings", () => {
  const view = (style: unknown) => [{ id: "v", name: "V", style }];
  const throwsView = (style: unknown) => assert.throws(() => validateSavedViews(view(style)), SettingsValidationError);
  throwsView("nope"); // not an object
  throwsView({ fontFamily: "comic-sans" }); // unknown font
  throwsView({ align: "justify" }); // unknown align
  throwsView({ textColor: "x".repeat(65) }); // over the colour cap
  throwsView({ title: "t".repeat(201) }); // over the title cap
  assert.doesNotThrow(() => validateSavedViews(view({ title: "Velocity", fontFamily: "serif", textColor: "#123456", background: "rgba(0,0,0,0.1)", align: "center" })));
  // The same guard applies to custom reports.
  const okReport = { id: "r", label: "R", scope: "tasks" as const, viz: "bar" as const, metrics: [{ id: "m", field: "count", agg: "count" as const }] };
  throws({ customReports: [{ ...okReport, style: { fontFamily: "papyrus" } }] });
  assert.doesNotThrow(() => updateSettings({ customReports: [{ ...okReport, style: { title: "By status" } }] }));
  updateSettings({ customReports: [] });
});

test("fieldOverrides support-map validation", () => {
  throws({ fieldOverrides: "nope" });
  throws({ fieldOverrides: { fields: "nope" } });
  throws({ fieldOverrides: { fields: { budget: "nope" } } });
  throws({ fieldOverrides: { fields: { budget: { surface: true } } } }); // store missing
  throws({ fieldOverrides: { entities: { issue: { surface: "yes", store: true } } } }); // non-boolean
  assert.doesNotThrow(() => updateSettings({ fieldOverrides: { fields: { budget: { surface: true, store: false } }, entities: {} } }));
});

test("loggingSync: sanitizeLoggingSync — safe url; enabling needs url + warranty ack (the `logging-sync` config def)", () => {
  const bad = (v: unknown) => assert.throws(() => sanitizeLoggingSync(v), SettingsValidationError);
  bad("nope");
  bad({ url: 5 });
  bad({ url: "http://169.254.169.254/logs" }); // unsafe
  bad({ enabled: true, url: "", acknowledgedWarranty: true }); // no url
  bad({ enabled: true, url: "https://logs.example.com", acknowledgedWarranty: false }); // no ack
  assert.deepEqual(
    sanitizeLoggingSync({ enabled: true, url: "https://logs.example.com", acknowledgedWarranty: true }),
    { enabled: true, url: "https://logs.example.com", acknowledgedWarranty: true },
  );
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

test("skillsPlanning: validates the matrix (proficiency 1–5, non-negative capacity) + demand", () => {
  throws({ skillsPlanning: "nope" });
  throws({ skillsPlanning: { matrix: [{ resourceId: "r", name: "R", skills: { react: 9 }, capacityHours: 10 }] } }); // proficiency > 5
  throws({ skillsPlanning: { matrix: [{ resourceId: "r", name: "R", skills: { react: 3 }, capacityHours: -1 }] } }); // negative capacity
  throws({ skillsPlanning: { demand: [{ id: "d", skill: "react", hoursNeeded: -5 }] } }); // negative hours
  throws({ skillsPlanning: { demand: [{ id: "d", skill: "react", hoursNeeded: 10, minProficiency: 0 }] } }); // bad bar
  assert.doesNotThrow(() => updateSettings({ skillsPlanning: { matrix: [{ resourceId: "r", name: "Ada", skills: { react: 4 }, capacityHours: 250 }], demand: [{ id: "d1", initiative: "x", skill: "react", hoursNeeded: 400, minProficiency: 3 }] } }));
  // Reset so it doesn't leak into other tests.
  updateSettings({ skillsPlanning: { matrix: [], demand: [] } });
});

test("governanceRules: the optional `when` predicate is validated (bad condition set rejected)", () => {
  throws({ governanceRules: [{ id: "r", when: { all: {} } }] }); // all must be an array, not an object
  throws({ governanceRules: [{ id: "r", when: "nope" }] }); // when must be an object
  throws({ governanceRules: [{ id: "r", when: { all: [{ op: "gt", value: 1 }] } }] }); // predicate missing field
  assert.doesNotThrow(() => updateSettings({ governanceRules: [{ id: "r", require: ["labels"], when: { all: [{ field: "projectType", op: "eq", value: "delivery" }] } }] }));
  updateSettings({ governanceRules: [] });
});

test("previously-unvalidated writable keys are type-checked (aiModel / backendSource / object maps)", () => {
  throws({ aiModel: 5 });
  throws({ backendSource: {} }); // object where a string is required (crashed broker-command before)
  throws({ capabilityStates: [] }); // array is not an object map
  throws({ screenLayouts: "nope" });
  throws({ userPrefs: 3 });
  assert.doesNotThrow(() => updateSettings({ aiModel: null, backendSource: "all", capabilityStates: {}, screenLayouts: {}, userPrefs: {} }));
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
