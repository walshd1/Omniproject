import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { updateSettings, getSettings, SettingsValidationError, DEFAULT_PRIORITY_WEIGHTS } from "./settings";

afterEach(() => {
  updateSettings({ savedViews: [], hiddenFields: [], disabledFeatures: [], dashboards: [], reportingCurrency: null, fxRatePolicy: "spot", fxRateAsOfDate: null, customReports: [], reportOverrides: [], contentPages: [], priorityWeights: { ...DEFAULT_PRIORITY_WEIGHTS } }); // reset shared store
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
