import { describe, it, expect } from "vitest";
import {
  CONTRACT_ACTIONS,
  CAPABILITY_DOMAINS,
  emptyBackendDraft,
  cloneFromCatalogue,
  parseBackendFile,
  evaluateDraft,
  toDraft,
  type BackendDraft,
} from "./backend-authoring";

/** A minimal but fully valid draft: id/label/docsUrl/via + one mapped action + an auth header. */
function validDraft(): BackendDraft {
  const draft = emptyBackendDraft();
  draft.id = "my-tool";
  draft.label = "My Tool";
  draft.docsUrl = "https://example.test/docs";
  draft.via = "HTTP + bearer token";
  draft.requiredEnv = ["MY_TOOL_URL", "MY_TOOL_TOKEN"];
  draft.capabilities.issues = true;
  draft.authHeader = "=Bearer {{ $env.MY_TOOL_TOKEN }}";
  draft.actions.list_issues = { ...draft.actions.list_issues, enabled: true, method: "GET", url: "={{ $env.MY_TOOL_URL }}/issues" };
  return draft;
}

describe("emptyBackendDraft", () => {
  it("seeds every contract action and every capability domain, all off/unmapped", () => {
    const draft = emptyBackendDraft();
    expect(Object.keys(draft.actions).sort()).toEqual([...CONTRACT_ACTIONS].sort());
    expect(Object.keys(draft.capabilities).sort()).toEqual([...CAPABILITY_DOMAINS].sort());
    expect(Object.values(draft.capabilities).every((v) => v === false)).toBe(true);
    expect(Object.values(draft.actions).every((a) => a.enabled === false)).toBe(true);
  });

  it("defaults verification to 'experimental' — a self-authored draft has no track record yet", () => {
    expect(emptyBackendDraft().verification).toBe("experimental");
  });
});

describe("evaluateDraft", () => {
  it("accepts a minimal valid backend with no errors", () => {
    const { errors, manifest } = evaluateDraft(validDraft());
    expect(errors).toEqual([]);
    expect(manifest["id"]).toBe("my-tool");
    expect(manifest["actions"]).toMatchObject({ list_issues: { method: "GET" } });
  });

  it("flags missing required fields (mirrors the schema's required[])", () => {
    const { errors } = evaluateDraft(emptyBackendDraft());
    expect(errors.some((e) => /label/.test(e))).toBe(true);
    expect(errors.some((e) => /docsUrl/.test(e))).toBe(true);
    expect(errors.some((e) => /via/.test(e))).toBe(true);
  });

  it("rejects an id with uppercase/spaces (schema pattern ^[a-z0-9-]+$)", () => {
    const draft = validDraft();
    draft.id = "My Tool!";
    const { errors } = evaluateDraft(draft);
    expect(errors.some((e) => /does not match/.test(e))).toBe(true);
  });

  it("omits disabled actions from the built manifest", () => {
    const draft = validDraft();
    draft.actions.create_issue = { ...draft.actions.create_issue, enabled: false, url: "https://ignored.test" };
    const { manifest } = evaluateDraft(draft);
    expect(Object.keys(manifest["actions"] as object)).toEqual(["list_issues"]);
  });

  it("reports invalid JSON in an n8nNode action's parameters as a blocking error", () => {
    const draft = validDraft();
    draft.actions.list_projects = { ...draft.actions.list_projects, enabled: true, kind: "n8nNode", node: "n8n-nodes-base.asana", parameters: "{not json" };
    const { errors } = evaluateDraft(draft);
    expect(errors.some((e) => /parameters is not valid JSON/.test(e))).toBe(true);
  });

  it("parses valid n8nNode parameters JSON into the manifest", () => {
    const draft = validDraft();
    draft.actions.list_projects = { ...draft.actions.list_projects, enabled: true, kind: "n8nNode", node: "n8n-nodes-base.asana", parameters: '{"resource":"project"}' };
    const { errors, manifest } = evaluateDraft(draft);
    expect(errors).toEqual([]);
    expect((manifest["actions"] as Record<string, { parameters?: unknown }>)["list_projects"]?.parameters).toEqual({ resource: "project" });
  });

  it("rejects a non-numeric type version as a blocking error", () => {
    const draft = validDraft();
    draft.actions.list_projects = { ...draft.actions.list_projects, enabled: true, kind: "n8nNode", node: "n8n-nodes-base.asana", typeVersion: "not-a-number" };
    const { errors } = evaluateDraft(draft);
    expect(errors.some((e) => /type version must be a number/.test(e))).toBe(true);
  });

  it("warns (non-blocking) about an unrecognised capability id", () => {
    const draft = validDraft();
    draft.capabilities["not-a-real-domain"] = true;
    const { errors, warnings } = evaluateDraft(draft);
    expect(errors).toEqual([]); // the schema allows arbitrary boolean capability keys
    expect(warnings.some((w) => /not-a-real-domain/.test(w))).toBe(true);
  });

  it("warns when no actions are mapped at all", () => {
    const draft = validDraft();
    draft.actions.list_issues = { ...draft.actions.list_issues, enabled: false };
    const { warnings } = evaluateDraft(draft);
    expect(warnings.some((w) => /can't do anything/.test(w))).toBe(true);
  });

  it("warns when the chosen id collides with a shipped catalogue backend", () => {
    const draft = validDraft();
    draft.id = "jira";
    const { warnings } = evaluateDraft(draft);
    expect(warnings.some((w) => /jira/.test(w) && /OVERRIDE/.test(w))).toBe(true);
  });

  it("carries the draft's verification status into the built manifest", () => {
    const draft = validDraft();
    draft.verification = "verified";
    const { manifest } = evaluateDraft(draft);
    expect(manifest["verification"]).toBe("verified");
  });

  it("includes keyFormat only once enabled with a scheme chosen", () => {
    const draft = validDraft();
    const before = evaluateDraft(draft).manifest;
    expect(before["keyFormat"]).toBeUndefined();

    draft.keyFormat = { enabled: true, scheme: "bearer", env: ["MY_TOOL_TOKEN"], header: "", pattern: "" };
    const after = evaluateDraft(draft).manifest;
    expect(after["keyFormat"]).toEqual({ scheme: "bearer", env: ["MY_TOOL_TOKEN"] });
  });

  it("passes validateVendor's own JSON Schema for a fully-populated draft (parity with the config-dir loader)", () => {
    const draft = validDraft();
    draft.kind = "database";
    draft.adminOnly = true;
    draft.notes = "Reference sidecar.";
    draft.credentialType = "myCustomApi";
    draft.keyFormat = { enabled: true, scheme: "bearer", env: ["MY_TOOL_TOKEN"], header: "Authorization", pattern: "^[a-f0-9]{32}$" };
    const { errors } = evaluateDraft(draft);
    expect(errors).toEqual([]);
  });
});

describe("cloneFromCatalogue / toDraft round-trip", () => {
  it("clones a shipped backend (todoist) into an editable, re-exportable draft", () => {
    const draft = cloneFromCatalogue("todoist");
    expect(draft).not.toBeNull();
    expect(draft!.id).toBe("todoist");
    expect(draft!.actions.list_issues.enabled).toBe(true);
    expect(draft!.actions.list_issues.url).toContain("todoist.com");
    expect(draft!.capabilities.issues).toBe(true);
    // A cloned shipped backend keeps its own verification status — it doesn't
    // regress to the blank-draft "experimental" default just because it was cloned.
    expect(draft!.verification).toBe("catalogued");

    const { errors } = evaluateDraft(draft!);
    expect(errors).toEqual([]);
  });

  it("returns null for an unknown id", () => {
    expect(cloneFromCatalogue("not-a-real-backend")).toBeNull();
  });

  it("round-trips a built manifest through toDraft without loss of the mapped fields", () => {
    const draft = validDraft();
    draft.verification = "verified";
    const { manifest } = evaluateDraft(draft);
    const restored = toDraft(manifest);
    expect(restored.id).toBe(draft.id);
    expect(restored.label).toBe(draft.label);
    expect(restored.verification).toBe("verified");
    expect(restored.actions.list_issues).toMatchObject({ enabled: true, method: "GET" });
    expect(evaluateDraft(restored).errors).toEqual([]);
  });

  it("falls back to the blank-draft default when an imported object's verification is missing/invalid", () => {
    expect(toDraft({ verification: "not-a-real-status" }).verification).toBe("experimental");
    expect(toDraft({}).verification).toBe("experimental");
  });
});

describe("parseBackendFile", () => {
  it("parses a valid backend definition file into a draft", () => {
    const draft = validDraft();
    const { manifest } = evaluateDraft(draft);
    const parsed = parseBackendFile(JSON.stringify(manifest));
    expect(parsed.id).toBe("my-tool");
    expect(evaluateDraft(parsed).errors).toEqual([]);
  });

  it("throws a friendly error on invalid JSON", () => {
    expect(() => parseBackendFile("{not json")).toThrow(/valid JSON/);
  });

  it("throws a friendly error on a non-object payload (e.g. an array)", () => {
    expect(() => parseBackendFile("[1,2,3]")).toThrow(/single backend definition/);
  });
});
