import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMspdi, mspdiDurationToHours } from "./msproject-xml";

/**
 * MSPDI (Project XML) parsing — the .mpp interchange story. The fixture exercises the traps:
 * a UID-0 project row, a summary row whose children must chain to it as parentTask, a Baseline
 * block whose Start/Finish must NOT shadow the task's own, predecessors with type+lag, multiple
 * resource assignments, and entity-escaped text.
 */

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Title>Warehouse &amp; Yard move</Title>
  <Tasks>
    <Task>
      <UID>0</UID><ID>0</ID><Name>Warehouse &amp; Yard move</Name>
      <OutlineLevel>0</OutlineLevel><Summary>1</Summary>
      <Start>2026-10-01T08:00:00</Start><Finish>2026-12-01T17:00:00</Finish>
    </Task>
    <Task>
      <UID>1</UID><ID>1</ID><Name>Phase 1 — Site prep</Name>
      <OutlineLevel>1</OutlineLevel><Summary>1</Summary><WBS>1</WBS>
      <Start>2026-10-01T08:00:00</Start><Finish>2026-10-20T17:00:00</Finish>
    </Task>
    <Task>
      <UID>2</UID><ID>2</ID><Name>Clear racking</Name>
      <OutlineLevel>2</OutlineLevel><Summary>0</Summary><WBS>1.1</WBS>
      <Start>2026-10-01T08:00:00</Start><Finish>2026-10-07T17:00:00</Finish>
      <Duration>PT40H0M0S</Duration><PercentComplete>25</PercentComplete>
      <Milestone>0</Milestone>
      <Notes>Forklift &lt;certified&gt; crew only</Notes>
      <Baseline><Number>0</Number><Start>2026-09-01T08:00:00</Start><Finish>2026-09-07T17:00:00</Finish><Duration>PT99H0M0S</Duration></Baseline>
    </Task>
    <Task>
      <UID>3</UID><ID>3</ID><Name>Power down &amp; disconnect</Name>
      <OutlineLevel>2</OutlineLevel><Summary>0</Summary><WBS>1.2</WBS>
      <Start>2026-10-08T08:00:00</Start><Finish>2026-10-08T12:00:00</Finish>
      <Duration>PT4H30M0S</Duration><PercentComplete>0</PercentComplete>
      <Milestone>1</Milestone>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>3</Type><LinkLag>4800</LinkLag></PredecessorLink>
    </Task>
  </Tasks>
  <Resources>
    <Resource><UID>10</UID><Name>Ade</Name></Resource>
    <Resource><UID>11</UID><Name>Bea</Name></Resource>
  </Resources>
  <Assignments>
    <Assignment><UID>100</UID><TaskUID>2</TaskUID><ResourceUID>10</ResourceUID></Assignment>
    <Assignment><UID>101</UID><TaskUID>2</TaskUID><ResourceUID>11</ResourceUID></Assignment>
  </Assignments>
</Project>`;

test("parses tasks, skipping structural rows but preserving the outline parent chain", () => {
  const out = parseMspdi(FIXTURE);
  assert.equal(out.projectName, "Warehouse & Yard move");
  assert.equal(out.skippedSummaries, 2); // UID 0 project row + the Phase 1 summary
  assert.deepEqual(out.rows.map((r) => r["Name"]), ["Clear racking", "Power down & disconnect"]);
  // Children of the skipped summary still chain to it as their parent.
  assert.equal(out.rows[0]!["Parent"], "Phase 1 — Site prep");
});

test("a Baseline block never shadows the task's own Start/Finish/Duration", () => {
  const row = parseMspdi(FIXTURE).rows[0]!;
  assert.equal(row["Start"], "2026-10-01T08:00:00"); // NOT the baseline's 2026-09-01
  assert.equal(row["Finish"], "2026-10-07T17:00:00");
  assert.equal(row["Duration"], 40); // PT40H, not the baseline's PT99H
  assert.equal(row["PercentComplete"], 25);
  assert.equal(row["WBS"], "1.1");
});

test("predecessors carry type + lag; milestones and multi-resource assignments resolve", () => {
  const rows = parseMspdi(FIXTURE).rows;
  const power = rows[1]!;
  assert.equal(power["Predecessors"], "2:FS;1:SS+4800");
  assert.equal(power["Milestone"], true);
  assert.equal(rows[0]!["Resource"], "Ade, Bea");
});

test("entity escapes are decoded in names and notes", () => {
  const rows = parseMspdi(FIXTURE).rows;
  assert.equal(rows[1]!["Name"], "Power down & disconnect");
  assert.equal(rows[0]!["Notes"], "Forklift <certified> crew only");
});

test("durations convert PT#H#M#S to decimal hours", () => {
  assert.equal(mspdiDurationToHours("PT8H30M0S"), 8.5);
  assert.equal(mspdiDurationToHours("PT0H45M0S"), 0.75);
  assert.equal(mspdiDurationToHours("PT1H0M30S"), 1.01);
  assert.equal(mspdiDurationToHours(null), null);
  assert.equal(mspdiDurationToHours("3 days"), null); // non-MSPDI junk stays null, never NaN
});

test("headers match the import-preview contract shape", () => {
  const out = parseMspdi(FIXTURE);
  assert.ok(out.headers.includes("Name") && out.headers.includes("Finish") && out.headers.includes("WBS"));
  for (const row of out.rows) for (const h of out.headers) assert.ok(h in row, `row must carry ${h}`);
});
