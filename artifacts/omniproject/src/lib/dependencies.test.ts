import { describe, it, expect, beforeEach } from "vitest";
import {
  materialOf,
  canonicalize,
  sha256Hex,
  hashContent,
  edgeKeyFor,
  createEdge,
  checkDrift,
  validateEdge,
  parseEdgeFile,
  loadEdges,
  addEdges,
  removeEdge,
  buildEdgeBundle,
  type ItemRef,
} from "./dependencies";

const from: ItemRef = { system: "jira", projectRef: "PLT", itemRef: "PLT-12" };
const to: ItemRef = { system: "servicenow", projectRef: "INC", itemRef: "INC-99" };

const jiraItem = { id: "PLT-12", title: "Migrate auth", status: "in_progress", assignee: "alice", dueDate: "2026-07-01", version: 3, description: "lots of secret content", labels: ["x"] };
const snowItem = { id: "INC-99", title: "Approve change", status: "open", assignee: "bob", dueDate: "2026-07-05", version: 1 };

beforeEach(() => window.sessionStorage.clear());

describe("hashing primitives", () => {
  it("materialOf keeps only material fields and drops everything else", () => {
    const m = materialOf(jiraItem);
    expect(m).toEqual({ status: "in_progress", title: "Migrate auth", assignee: "alice", dueDate: "2026-07-01", version: 3 });
    expect(m).not.toHaveProperty("description");
    expect(m).not.toHaveProperty("labels");
  });

  it("canonicalize is key-order independent", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("sha256Hex is deterministic and 64 hex chars", async () => {
    const h = await sha256Hex("hello");
    expect(h).toBe(await sha256Hex("hello"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashContent is stable across key order and changes when a material field changes", async () => {
    const h1 = await hashContent(jiraItem);
    const h2 = await hashContent({ ...jiraItem, description: "DIFFERENT non-material" });
    expect(h2).toBe(h1); // non-material change → same fingerprint
    const h3 = await hashContent({ ...jiraItem, status: "done" });
    expect(h3).not.toBe(h1); // material change → different fingerprint
  });
});

describe("edge identity (idempotency)", () => {
  it("edgeKeyFor is deterministic for the same pair+type", async () => {
    expect(await edgeKeyFor(from, to, "blocks")).toBe(await edgeKeyFor(from, to, "blocks"));
  });
  it("differs by type and by direction", async () => {
    expect(await edgeKeyFor(from, to, "blocks")).not.toBe(await edgeKeyFor(from, to, "relates_to"));
    expect(await edgeKeyFor(from, to, "blocks")).not.toBe(await edgeKeyFor(to, from, "blocks"));
  });
});

describe("createEdge — ANTI-CREEP: stores only hashes + refs, never content", () => {
  it("produces an edge with exactly the allowed keys", async () => {
    const edge = await createEdge(from, to, "blocks", jiraItem, snowItem, { assertedAt: "2026-06-01T00:00:00Z" });
    expect(Object.keys(edge).sort()).toEqual(
      ["assertedAt", "edgeKey", "from", "fromHash", "schema", "to", "toHash", "type"].sort(),
    );
  });

  it("the serialized edge contains NO item content (no title/status/assignee values)", async () => {
    const edge = await createEdge(from, to, "blocks", jiraItem, snowItem);
    const json = JSON.stringify(edge);
    expect(json).not.toContain("Migrate auth");
    expect(json).not.toContain("in_progress");
    expect(json).not.toContain("alice");
    expect(json).not.toContain("secret content");
    // It DOES carry the opaque fingerprints + the minimal refs to re-read live.
    expect(edge.fromHash).toMatch(/^[0-9a-f]{64}$/);
    expect(edge.from.itemRef).toBe("PLT-12");
  });
});

describe("drift detection", () => {
  it("flags no drift when the live items are unchanged", async () => {
    const edge = await createEdge(from, to, "blocks", jiraItem, snowItem);
    expect(await checkDrift(edge, jiraItem, snowItem)).toEqual({ fromDrift: false, toDrift: false, drifted: false });
  });

  it("flags drift when a material field on either side changes", async () => {
    const edge = await createEdge(from, to, "blocks", jiraItem, snowItem);
    const d = await checkDrift(edge, { ...jiraItem, status: "done" }, snowItem);
    expect(d).toEqual({ fromDrift: true, toDrift: false, drifted: true });
  });
});

describe("persistence + dedupe + export/import", () => {
  it("addEdges de-dupes by edgeKey (re-linking the same pair is idempotent)", async () => {
    const e1 = await createEdge(from, to, "blocks", jiraItem, snowItem);
    const e1again = await createEdge(from, to, "blocks", { ...jiraItem, status: "done" }, snowItem);
    let list = addEdges([], [e1]);
    list = addEdges(list, [e1again]); // same edgeKey → replaces, no dup
    expect(list).toHaveLength(1);
    expect(loadEdges()).toHaveLength(1); // persisted to sessionStorage
  });

  it("removeEdge drops by edgeKey and persists", async () => {
    const e1 = await createEdge(from, to, "blocks", jiraItem, snowItem);
    const list = addEdges([], [e1]);
    expect(removeEdge(list, e1.edgeKey)).toHaveLength(0);
    expect(loadEdges()).toHaveLength(0);
  });

  it("validateEdge/parseEdgeFile accept valid edges and reject junk", async () => {
    const e1 = await createEdge(from, to, "blocks", jiraItem, snowItem);
    expect(validateEdge(e1)).not.toBeNull();
    expect(validateEdge({})).toBeNull();
    expect(validateEdge({ ...e1, type: "bogus" })).toBeNull();
    expect(parseEdgeFile(JSON.stringify(e1))).toHaveLength(1);
    expect(parseEdgeFile(JSON.stringify(buildEdgeBundle([e1])))).toHaveLength(1);
    expect(parseEdgeFile("not json")).toEqual([]);
  });
});
