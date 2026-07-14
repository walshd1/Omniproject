import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOmniStoreBackend } from "./backend";
import type { ActorCtx } from "../reference-broker-blueprint";

/**
 * OmniStore is the SUPERSET store — it copes with data shaped like ANY of the 43 third-party backends,
 * because the canonical model already covers their fields (links, hierarchy, agile, financials, CRM,
 * service, …) and OmniStore persists the WHOLE Row. This proves a Jira-shaped, a Todoist-shaped and a
 * GitHub-shaped issue all round-trip losslessly — canonical fields, Jira-class LINK/hierarchy fields,
 * AND vendor-native extension fields no other store would keep.
 */
const ctx = {} as ActorCtx;

test("a Jira-class issue (links, epic, sprint, points + vendor-native fields) round-trips intact", async () => {
  const be = loadOmniStoreBackend(null);
  const p = await be.createProject(ctx, { name: "Migrated from Jira" });
  const created = await be.createIssue(ctx, String(p["id"]), {
    title: "Ship the thing",
    status: "in_progress",
    storyPoints: 8,
    epic: "EPIC-1",
    sprint: "Sprint 5",
    acceptanceCriteria: "It ships.",
    dependsOn: ["iss-99"],          // canonical LINK field (Jira "is blocked by")
    blocks: ["iss-100"],            // canonical LINK field
    parentTask: "iss-1",            // hierarchy
    jira_customfield_10001: "TEAM-A", // vendor-native extension no canonical field covers
  });
  const back = await be.getIssue(ctx, String(p["id"]), String(created["id"]));
  assert.ok(back);
  assert.equal(back!["storyPoints"], 8);
  assert.equal(back!["epic"], "EPIC-1");
  assert.deepEqual(back!["dependsOn"], ["iss-99"]);   // links preserved as fields (no separate entity)
  assert.deepEqual(back!["blocks"], ["iss-100"]);
  assert.equal(back!["jira_customfield_10001"], "TEAM-A"); // superset: vendor field kept, not stripped
});

test("Todoist- and GitHub-shaped items also round-trip (any vendor's native fields survive)", async () => {
  const be = loadOmniStoreBackend(null);
  const p = await be.createProject(ctx, { name: "Mixed sources" });
  // Todoist: content/section/labels/energy + a native id.
  const todo = await be.createIssue(ctx, String(p["id"]), {
    title: "Buy milk", status: "todo", section: "Errands", labels: ["home"], energy: "low", todoist_id: "9876",
  });
  // GitHub: number/milestone/reactions + native fields.
  const gh = await be.createIssue(ctx, String(p["id"]), {
    title: "Fix bug", status: "todo", milestone: "v1.2", gh_number: 42, gh_reactions: { "+1": 3 },
  });
  const back1 = await be.getIssue(ctx, String(p["id"]), String(todo["id"]));
  const back2 = await be.getIssue(ctx, String(p["id"]), String(gh["id"]));
  assert.equal(back1!["todoist_id"], "9876");
  assert.equal(back1!["energy"], "low");
  assert.equal(back2!["gh_number"], 42);
  assert.deepEqual(back2!["gh_reactions"], { "+1": 3 });
});

test("mix-and-match ready: OmniStore can hold the fields a vendor DOESN'T expose alongside canonical ones", async () => {
  // The field-routing matrix decides which fields come from where; OmniStore is the overflow source.
  // Here it holds OmniProject-only + vendor-absent fields on the same issue as canonical ones.
  const be = loadOmniStoreBackend(null);
  const p = await be.createProject(ctx, { name: "Federated", omniInstanceId: "guid-abc" });
  const i = await be.createIssue(ctx, String(p["id"]), {
    title: "Federated issue",
    status: "todo",
    costCentre: "CC-42",        // OmniProject-only extension the vendor API can't hold
    riskExposure: 12,           // canonical field some vendors lack
  });
  const back = await be.getIssue(ctx, String(p["id"]), String(i["id"]));
  assert.equal(back!["costCentre"], "CC-42");
  assert.equal(back!["riskExposure"], 12);
  assert.equal((await be.listProjects(ctx)).find((x) => x["id"] === p["id"])!["omniInstanceId"], "guid-abc");
});
