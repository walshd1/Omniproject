import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { updateSettings, getSettings, redactSettingsForRead, SettingsValidationError, DEFAULT_PRIORITY_WEIGHTS, validateSavedViews } from "./settings";

afterEach(() => {
  updateSettings({ disabledFeatures: [], reportingCurrency: null, fxRatePolicy: "spot", fxRateAsOfDate: null, reportOverrides: [], contentPages: [], priorityWeights: { ...DEFAULT_PRIORITY_WEIGHTS }, federatedPeers: [] }); // reset shared store
});

// errorTelemetry left SettingsState for the `error-telemetry` config def (roadmap Phase C, slice 7b) — it is now
// a SECURITY-classified config governed by the floor gate. Its boolean validation + guard round-trip is covered
// by error-telemetry-routes.test / config-guard.test, not here.

test("reportOverrides: accepts partial metadata overrides and rejects bad shape", () => {
  const ok = updateSettings({ reportOverrides: [{ id: "evm", label: "Earned value", order: 5, hidden: true }, { id: "burndown" }] });
  assert.equal(ok.reportOverrides.length, 2);
  assert.throws(() => updateSettings({ reportOverrides: [{ label: "no id" }] as unknown as [] }), SettingsValidationError); // missing id
  assert.throws(() => updateSettings({ reportOverrides: [{ id: "x", order: "nope" }] as unknown as [] }), SettingsValidationError); // bad order
  assert.throws(() => updateSettings({ reportOverrides: [{ id: "x", hidden: "yes" }] as unknown as [] }), SettingsValidationError); // bad hidden
});

test("contentPages: accepts a well-formed page and persists the component-id order", () => {
  const ok = updateSettings({ contentPages: [{ id: "p1", name: "Exec view", componentIds: ["report:evm", "widget:portfolioHealth"] }] });
  assert.equal(ok.contentPages.length, 1);
  assert.deepEqual(getSettings().contentPages[0]!.componentIds, ["report:evm", "widget:portfolioHealth"]);
});

test("contentPages: rejects a non-array, a page missing id/name, and non-string componentIds", () => {
  assert.throws(() => updateSettings({ contentPages: "nope" as unknown as [] }), SettingsValidationError);
  assert.throws(() => updateSettings({ contentPages: [{ name: "no id", componentIds: [] }] as never }), SettingsValidationError);
  assert.throws(() => updateSettings({ contentPages: [{ id: "p", componentIds: [] }] as never }), SettingsValidationError); // no name
  assert.throws(() => updateSettings({ contentPages: [{ id: "p", name: "x", componentIds: [1, 2] }] as never }), SettingsValidationError); // non-string ids
  assert.throws(() => updateSettings({ contentPages: [{ id: "p", name: "x" }] as never }), SettingsValidationError); // missing componentIds
});

test("priorityWeights: accepts a well-formed weight set and rejects bad shape", () => {
  const ok = updateSettings({ priorityWeights: { rice: 30, wsjf: 30, moscow: 10, strategic: 10, benefit: 20 } });
  assert.equal(ok.priorityWeights.rice, 30);
  assert.throws(() => updateSettings({ priorityWeights: { rice: 30, wsjf: 30, moscow: 10, strategic: 10 } }), SettingsValidationError); // missing benefit
  assert.throws(() => updateSettings({ priorityWeights: { rice: -1, wsjf: 30, moscow: 10, strategic: 10, benefit: 20 } }), SettingsValidationError); // negative
  assert.throws(() => updateSettings({ priorityWeights: { rice: "high", wsjf: 30, moscow: 10, strategic: 10, benefit: 20 } }), SettingsValidationError); // not a number
  assert.throws(() => updateSettings({ priorityWeights: null }), SettingsValidationError); // not an object
});

test("reportingCurrency: accepts a 3-letter ISO code (upper-cased), null to clear, rejects junk", () => {
  assert.equal(updateSettings({ reportingCurrency: "eur" }).reportingCurrency, "EUR"); // normalised to upper
  assert.equal(updateSettings({ reportingCurrency: null }).reportingCurrency, null); // cleared
  assert.throws(() => updateSettings({ reportingCurrency: "EUROS" }), SettingsValidationError); // not 3 letters
  assert.throws(() => updateSettings({ reportingCurrency: "12" as string }), SettingsValidationError);
});

test("fxRatePolicy: accepts spot/periodClose/budgetRate, rejects anything else", () => {
  assert.equal(updateSettings({ fxRatePolicy: "periodClose" }).fxRatePolicy, "periodClose");
  assert.equal(updateSettings({ fxRatePolicy: "budgetRate" }).fxRatePolicy, "budgetRate");
  assert.equal(updateSettings({ fxRatePolicy: "spot" }).fxRatePolicy, "spot");
  assert.throws(() => updateSettings({ fxRatePolicy: "yesterday" }), SettingsValidationError);
});

test("fxRateAsOfDate: accepts an ISO date, null to clear, rejects an unparseable string", () => {
  assert.equal(updateSettings({ fxRateAsOfDate: "2026-06-30" }).fxRateAsOfDate, "2026-06-30");
  assert.equal(updateSettings({ fxRateAsOfDate: null }).fxRateAsOfDate, null);
  assert.throws(() => updateSettings({ fxRateAsOfDate: "not-a-date" }), SettingsValidationError);
});

// savedViews left settings for a `saved-views` config def (routes/views); its validator `validateSavedViews`
// (throws on a bad shape) is exercised directly here — the same coverage the updateSettings path had.
test("savedViews: accepts well-formed views", () => {
  assert.doesNotThrow(() => validateSavedViews([
    { id: "v1", name: "My grid", scope: "grid", columns: ["title", "status"], sort: { field: "status", dir: "asc" } },
    { id: "v2", name: "Due soon" },
  ]));
});

test("savedViews: rejects a non-array and a view missing id/name", () => {
  assert.throws(() => validateSavedViews("nope"), SettingsValidationError);
  assert.throws(() => validateSavedViews([{ name: "no id" }]), SettingsValidationError);
  assert.throws(() => validateSavedViews([{ id: "x" }]), SettingsValidationError);
});

test("savedViews: accepts view-engine fields (entity/viewKind/filters/groupBy)", () => {
  assert.doesNotThrow(() => validateSavedViews([
    { id: "e1", name: "Blocked", entity: "issue", viewKind: "board", filters: [{ field: "status", value: "in_progress" }], groupBy: "assignee", sort: { field: "priority", dir: "desc" } },
  ]));
});

test("savedViews: accepts the table viewKind with columns", () => {
  assert.doesNotThrow(() => validateSavedViews([{ id: "t1", name: "Table", entity: "task", viewKind: "table", columns: ["status", "assignee"] }]));
});

test("savedViews: accepts the chart viewKind with a chart spec, rejects a bad chart type", () => {
  assert.doesNotThrow(() => validateSavedViews([{ id: "cv1", name: "By status", entity: "task", viewKind: "chart", chart: { type: "gantt", startField: "startDate", endField: "dueDate" } }]));
  assert.throws(() => validateSavedViews([{ id: "x", name: "n", viewKind: "chart", chart: { type: "sunburst" } }]), SettingsValidationError);
});

test("savedViews: accepts the timeline viewKind with a dateField", () => {
  assert.doesNotThrow(() => validateSavedViews([{ id: "tl1", name: "Timeline", entity: "issue", viewKind: "timeline", dateField: "dueDate" }]));
  assert.throws(() => validateSavedViews([{ id: "x", name: "n", dateField: 5 }]), SettingsValidationError);
});

test("savedViews: rejects malformed view-engine fields", () => {
  assert.throws(() => validateSavedViews([{ id: "x", name: "n", entity: "widget" }]), SettingsValidationError);
  assert.throws(() => validateSavedViews([{ id: "x", name: "n", viewKind: "grid" }]), SettingsValidationError);
  assert.throws(() => validateSavedViews([{ id: "x", name: "n", sort: { field: "s", dir: "up" } }]), SettingsValidationError);
  assert.throws(() => validateSavedViews([{ id: "x", name: "n", filters: [{ field: "s" }] }]), SettingsValidationError);
});

// NB hiddenFields is no longer a settings key — it's a config-def-backed collection (`hidden-fields`, via
// settingsCollectionRouter's config mode). Its sanitiser (sanitizeHiddenFields) is exercised in the
// availability-curation route test.

// ── Federated peers (backlog #135) ────────────────────────────────────────────

test("federatedPeers: accepts a well-formed peer and persists it", () => {
  const peers = [{ id: "eu", label: "EU instance", baseUrl: "https://eu.omni.example", token: "tok-1", region: "eu", active: true }];
  const s = updateSettings({ federatedPeers: peers });
  assert.equal(s.federatedPeers.length, 1);
  assert.equal(getSettings().federatedPeers[0]!.baseUrl, "https://eu.omni.example");
});

test("federatedPeers: rejects a non-array, a peer missing id/label/baseUrl/token, and an unsafe baseUrl", () => {
  assert.throws(() => updateSettings({ federatedPeers: "nope" as unknown as [] }), SettingsValidationError);
  assert.throws(() => updateSettings({ federatedPeers: [{ label: "no id", baseUrl: "https://x", token: "t" }] as never }), SettingsValidationError);
  assert.throws(() => updateSettings({ federatedPeers: [{ id: "p1", baseUrl: "https://x", token: "t" }] as never }), SettingsValidationError); // no label
  assert.throws(() => updateSettings({ federatedPeers: [{ id: "p1", label: "x", token: "t" }] as never }), SettingsValidationError); // no baseUrl
  assert.throws(() => updateSettings({ federatedPeers: [{ id: "p1", label: "x", baseUrl: "https://x" }] as never }), SettingsValidationError); // no token
  assert.throws(() => updateSettings({ federatedPeers: [{ id: "p1", label: "x", baseUrl: "http://169.254.169.254/", token: "t" }] as never }), SettingsValidationError); // link-local
  assert.throws(() => updateSettings({ federatedPeers: [{ id: "p1", label: "x", baseUrl: "https://x", token: "t", region: 5 }] as never }), SettingsValidationError); // bad region type
  assert.throws(() => updateSettings({ federatedPeers: [{ id: "p1", label: "x", baseUrl: "https://x", token: "t", active: "yes" }] as never }), SettingsValidationError); // bad active type
});

test("redactSettingsForRead: masks federated-peer tokens (never leaked over GET)", () => {
  const redacted = redactSettingsForRead({
    ...getSettings(),
    federatedPeers: [{ id: "eu", label: "EU", baseUrl: "https://eu.omni.example", token: "super-secret-token", region: "eu", active: true }],
  });
  assert.equal(redacted.federatedPeers[0]!.token, "********");
  assert.equal(redacted.federatedPeers[0]!.baseUrl, "https://eu.omni.example"); // non-secret fields preserved
});

// NB branding + labelOverrides are no longer settings keys — they're `branding`/`label-overrides` config defs
// (see lib/branding, lib/labels). The bulk PATCH can no longer set them; the font-stack / catalogue guards are
// applied by saveBranding/saveLabels on write AND defensively on read (orgBranding/orgLabels), covered by
// premium-config.test + labels tests.

test("scope feature maps reject a feature that is both required and forbidden in a scope", () => {
  // programmeFeatures / projectFeatures are per-scope require/forbid maps. Mirror validateGovernance's
  // contradiction guard so the per-scope maps aren't a bypass on the bulk PATCH / config-restore path.
  assert.throws(
    () => updateSettings({ programmeFeatures: { "prog-1": { required: ["gantt"], forbidden: ["gantt"] } } }),
    SettingsValidationError,
  );
  assert.throws(
    () => updateSettings({ projectFeatures: { "proj-1": { required: ["risks"], forbidden: ["risks"] } } }),
    SettingsValidationError,
  );
  // A non-contradictory per-scope map still persists.
  const s = updateSettings({ programmeFeatures: { "prog-1": { required: ["gantt"], forbidden: ["kanban"] } } });
  assert.deepEqual((s.programmeFeatures["prog-1"] as { required: string[] }).required, ["gantt"]);
  updateSettings({ programmeFeatures: {}, projectFeatures: {} });
});

test("userPrefs entries are clamped to valid ranges/enums through the bulk PATCH", () => {
  const s = updateSettings({ userPrefs: { "u1": { fontScale: 99, backgroundColor: "not-a-hex", switchScan: "bogus", density: "compact" } } });
  const p = s.userPrefs["u1"] as { fontScale: number; backgroundColor: string | null; switchScan: string; density: string };
  assert.ok(p.fontScale <= 1.5 && p.fontScale >= 0.85, "fontScale clamped");
  assert.equal(p.backgroundColor, null); // invalid hex dropped
  assert.equal(p.switchScan, "off");     // unknown enum → default
  assert.equal(p.density, "compact");    // valid enum kept
  updateSettings({ userPrefs: {} });
});

test("calendarPush can't persist a forged 'granted' consent with an uncatalogued target", () => {
  const s = updateSettings({ calendarPush: { "victim": { granted: true, target: "http://attacker", scope: "all", grantedAt: "2000-01-01T00:00:00Z" } } });
  const g = s.calendarPush["victim"] as { granted: boolean; target: string | null };
  assert.equal(g.granted, false);  // consent to an uncatalogued target is void
  assert.equal(g.target, null);
  updateSettings({ calendarPush: {} });
});

test("featureGovernance rejects a feature that is both required and forbidden", () => {
  assert.throws(() => updateSettings({ featureGovernance: { required: ["globalSearch"], forbidden: ["globalSearch"] } }), SettingsValidationError);
  const ok = updateSettings({ featureGovernance: { required: ["globalSearch"], forbidden: ["comments"] } });
  assert.deepEqual(ok.featureGovernance, { required: ["globalSearch"], forbidden: ["comments"] });
  updateSettings({ featureGovernance: { required: [], forbidden: [] } });
});
