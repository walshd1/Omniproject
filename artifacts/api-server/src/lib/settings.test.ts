import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { updateSettings, getSettings, redactSettingsForRead, SettingsValidationError, DEFAULT_PRIORITY_WEIGHTS } from "./settings";

afterEach(() => {
  updateSettings({ savedViews: [], hiddenFields: [], disabledFeatures: [], dashboards: [], reportingCurrency: null, fxRatePolicy: "spot", fxRateAsOfDate: null, customReports: [], reportOverrides: [], contentPages: [], priorityWeights: { ...DEFAULT_PRIORITY_WEIGHTS }, federatedPeers: [] }); // reset shared store
});

test("errorTelemetry: accepts a boolean, rejects a non-boolean, defaults off", () => {
  assert.equal(getSettings().errorTelemetry, false); // off by default
  assert.equal(updateSettings({ errorTelemetry: true }).errorTelemetry, true);
  assert.equal(updateSettings({ errorTelemetry: false }).errorTelemetry, false);
  assert.throws(() => updateSettings({ errorTelemetry: "yes" as unknown as boolean }), SettingsValidationError);
});

test("reportOverrides: accepts partial metadata overrides and rejects bad shape", () => {
  const ok = updateSettings({ reportOverrides: [{ id: "evm", label: "Earned value", order: 5, hidden: true }, { id: "burndown" }] });
  assert.equal(ok.reportOverrides.length, 2);
  assert.throws(() => updateSettings({ reportOverrides: [{ label: "no id" }] as unknown as [] }), SettingsValidationError); // missing id
  assert.throws(() => updateSettings({ reportOverrides: [{ id: "x", order: "nope" }] as unknown as [] }), SettingsValidationError); // bad order
  assert.throws(() => updateSettings({ reportOverrides: [{ id: "x", hidden: "yes" }] as unknown as [] }), SettingsValidationError); // bad hidden
});

test("dashboards: accept an optional refreshMs and reject a negative one", () => {
  const ok = updateSettings({ dashboards: [{ id: "d1", name: "Ops", widgets: [], refreshMs: 30000 }] });
  assert.equal(ok.dashboards[0]!.refreshMs, 30000);
  assert.throws(() => updateSettings({ dashboards: [{ id: "d2", name: "Bad", widgets: [], refreshMs: -5 }] as unknown as [] }), SettingsValidationError);
});

test("customReports: accepts a well-formed bespoke report and rejects bad shape", () => {
  const ok = updateSettings({ customReports: [{ id: "r1", label: "Spend by status", scope: "project", groupBy: "status", metrics: [{ id: "m1", field: "budget", agg: "sum" }], viz: "bar" }] });
  assert.equal(ok.customReports.length, 1);
  assert.throws(() => updateSettings({ customReports: [{ id: "r2", label: "x", scope: "nope", metrics: [{ id: "m", field: "b", agg: "sum" }], viz: "table" }] }), SettingsValidationError); // bad scope
  assert.throws(() => updateSettings({ customReports: [{ id: "r3", label: "x", scope: "project", metrics: [], viz: "table" }] }), SettingsValidationError); // no metrics
  assert.throws(() => updateSettings({ customReports: [{ id: "r4", label: "x", scope: "project", metrics: [{ id: "m", field: "b", agg: "median" }], viz: "table" }] }), SettingsValidationError); // bad agg
});

test("customReports: accepts the tasks scope (report over the GTD task entity)", () => {
  const ok = updateSettings({ customReports: [{ id: "rt", label: "Tasks by context", scope: "tasks", groupBy: "context", metrics: [{ id: "m1", field: "id", agg: "count" }], viz: "bar" }] });
  assert.equal(ok.customReports[0]!.scope, "tasks");
});

test("customReports: accepts groupBy2 (pivot) and viz:line + dateField (trend), rejects bad shapes for both", () => {
  const pivot = updateSettings({ customReports: [{ id: "r5", label: "Pivot", scope: "project", groupBy: "status", groupBy2: "region", metrics: [{ id: "m1", field: "budget", agg: "sum" }], viz: "table" }] });
  assert.equal(pivot.customReports[0]!.groupBy2, "region");
  const trend = updateSettings({ customReports: [{ id: "r6", label: "Trend", scope: "project", dateField: "closedAt", metrics: [{ id: "m1", field: "budget", agg: "sum" }], viz: "line" }] });
  assert.equal(trend.customReports[0]!.viz, "line");
  assert.throws(() => updateSettings({ customReports: [{ id: "r7", label: "x", scope: "project", groupBy2: 5, metrics: [{ id: "m", field: "b", agg: "sum" }], viz: "table" }] as never }), SettingsValidationError); // bad groupBy2
  assert.throws(() => updateSettings({ customReports: [{ id: "r8", label: "x", scope: "project", dateField: 5, metrics: [{ id: "m", field: "b", agg: "sum" }], viz: "line" }] as never }), SettingsValidationError); // bad dateField
  assert.throws(() => updateSettings({ customReports: [{ id: "r9", label: "x", scope: "project", metrics: [{ id: "m", field: "b", agg: "sum" }], viz: "pie" }] as never }), SettingsValidationError); // bad viz
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

test("savedViews: accepts well-formed views and persists them", () => {
  const views = [
    { id: "v1", name: "My grid", scope: "grid", columns: ["title", "status"], sort: { field: "status", dir: "asc" as const } },
    { id: "v2", name: "Due soon" },
  ];
  const s = updateSettings({ savedViews: views });
  assert.equal(s.savedViews.length, 2);
  assert.equal(getSettings().savedViews[0]!.name, "My grid");
});

test("savedViews: rejects a non-array and a view missing id/name", () => {
  assert.throws(() => updateSettings({ savedViews: "nope" }), SettingsValidationError);
  assert.throws(() => updateSettings({ savedViews: [{ name: "no id" }] }), SettingsValidationError);
  assert.throws(() => updateSettings({ savedViews: [{ id: "x" }] }), SettingsValidationError);
});

test("savedViews: accepts view-engine fields (entity/viewKind/filters/groupBy)", () => {
  const s = updateSettings({ savedViews: [
    { id: "e1", name: "Blocked", entity: "issue", viewKind: "board", filters: [{ field: "status", value: "in_progress" }], groupBy: "assignee", sort: { field: "priority", dir: "desc" as const } },
  ] });
  assert.equal(s.savedViews[0]!.entity, "issue");
  assert.equal(s.savedViews[0]!.viewKind, "board");
});

test("savedViews: rejects malformed view-engine fields", () => {
  assert.throws(() => updateSettings({ savedViews: [{ id: "x", name: "n", entity: "widget" }] }), SettingsValidationError);
  assert.throws(() => updateSettings({ savedViews: [{ id: "x", name: "n", viewKind: "grid" }] }), SettingsValidationError);
  assert.throws(() => updateSettings({ savedViews: [{ id: "x", name: "n", sort: { field: "s", dir: "up" } }] }), SettingsValidationError);
  assert.throws(() => updateSettings({ savedViews: [{ id: "x", name: "n", filters: [{ field: "s" }] }] }), SettingsValidationError);
});

test("hiddenFields: rejects a non-string-array", () => {
  assert.throws(() => updateSettings({ hiddenFields: [1, 2] as unknown as string[] }), SettingsValidationError);
  assert.deepEqual(updateSettings({ hiddenFields: ["dueDate"] }).hiddenFields, ["dueDate"]);
});

test("dashboards: accepts well-formed dashboards and persists them", () => {
  const dashboards = [
    { id: "d1", name: "Exec", widgets: [{ id: "w1", type: "portfolioHealth", span: 3 as const }, { id: "w2", type: "recentActivity" }] },
    { id: "d2", name: "Empty", widgets: [] },
  ];
  const s = updateSettings({ dashboards });
  assert.equal(s.dashboards.length, 2);
  assert.equal(getSettings().dashboards[0]!.widgets[0]!.type, "portfolioHealth");
});

test("dashboards: rejects a non-array, a dashboard missing id/name/widgets, and a widget missing id/type", () => {
  assert.throws(() => updateSettings({ dashboards: "nope" as unknown as [] }), SettingsValidationError);
  assert.throws(() => updateSettings({ dashboards: [{ name: "no id", widgets: [] }] as never }), SettingsValidationError);
  assert.throws(() => updateSettings({ dashboards: [{ id: "d", name: "no widgets" }] as never }), SettingsValidationError);
  assert.throws(() => updateSettings({ dashboards: [{ id: "d", name: "x", widgets: [{ type: "noId" }] }] as never }), SettingsValidationError);
  assert.throws(() => updateSettings({ dashboards: [{ id: "d", name: "x", widgets: [{ id: "w" }] }] as never }), SettingsValidationError);
});

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
