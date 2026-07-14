import { describe, it, expect, vi } from "vitest";
import {
  CONTRACT_ACTIONS,
  CAPABILITY_DOMAINS,
  emptyBackendDraft,
  cloneFromCatalogue,
  parseBackendFile,
  evaluateDraft,
  toDraft,
  downloadBackendManifest,
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

  it("throws on a JSON null payload (parses fine but isn't an object)", () => {
    expect(() => parseBackendFile("null")).toThrow(/single backend definition/);
  });
});

describe("buildManifest branch coverage (via evaluateDraft)", () => {
  it("carries every optional action field through to the built mapping", () => {
    const draft = validDraft();
    draft.actions.create_issue = {
      enabled: true,
      kind: "httpRequest",
      method: "POST",
      url: "  https://api.test/issues  ",
      body: "  {\"x\":1}  ",
      credentialType: "  myApi  ",
      node: "  n8n-nodes-base.httpRequest  ",
      typeVersion: "  2  ",
      parameters: '  {"resource":"issue"}  ',
      note: "  creates an issue  ",
    };
    const mapping = (evaluateDraft(draft).manifest["actions"] as Record<string, Record<string, unknown>>)["create_issue"]!;
    expect(mapping).toEqual({
      kind: "httpRequest",
      method: "POST",
      url: "https://api.test/issues",
      body: '{"x":1}',
      credentialType: "myApi",
      node: "n8n-nodes-base.httpRequest",
      typeVersion: 2,
      parameters: { resource: "issue" },
      note: "creates an issue",
    });
  });

  it("drops blank/whitespace-only optional action fields rather than emitting empty strings", () => {
    const draft = validDraft();
    // list_issues is enabled with only method+url; every other field blank.
    const mapping = (evaluateDraft(draft).manifest["actions"] as Record<string, Record<string, unknown>>)["list_issues"]!;
    expect(mapping).toEqual({ method: "GET", url: "={{ $env.MY_TOOL_URL }}/issues" });
    expect("body" in mapping).toBe(false);
    expect("note" in mapping).toBe(false);
    expect("kind" in mapping).toBe(false);
  });

  it("includes the manifest-level kind/adminOnly/notes/credentialType only when set", () => {
    const bare = evaluateDraft(validDraft()).manifest;
    expect("kind" in bare).toBe(false);
    expect("adminOnly" in bare).toBe(false);
    expect("notes" in bare).toBe(false);
    expect("credentialType" in bare).toBe(false);

    const draft = validDraft();
    draft.kind = "import";
    draft.adminOnly = true;
    draft.notes = "  a note  ";
    draft.credentialType = "  myApi  ";
    const m = evaluateDraft(draft).manifest;
    expect(m["kind"]).toBe("import");
    expect(m["adminOnly"]).toBe(true);
    expect(m["notes"]).toBe("a note");
    expect(m["credentialType"]).toBe("myApi");
  });

  it("emits keyFormat header+pattern and trims/filters the env list; omits an all-blank env", () => {
    const draft = validDraft();
    draft.keyFormat = { enabled: true, scheme: "apiKey", env: ["  A  ", "", "  "], header: "  X-Key  ", pattern: "  ^k.*$  " };
    const kf = evaluateDraft(draft).manifest["keyFormat"] as Record<string, unknown>;
    expect(kf).toEqual({ scheme: "apiKey", env: ["A"], header: "X-Key", pattern: "^k.*$" });

    // All-blank env → env key omitted entirely.
    draft.keyFormat = { enabled: true, scheme: "none", env: ["", "  "], header: "", pattern: "" };
    const kf2 = evaluateDraft(draft).manifest["keyFormat"] as Record<string, unknown>;
    expect(kf2).toEqual({ scheme: "none" });
  });

  it("omits keyFormat when enabled but no scheme is chosen", () => {
    const draft = validDraft();
    draft.keyFormat = { enabled: true, scheme: "", env: ["A"], header: "H", pattern: "" };
    expect(evaluateDraft(draft).manifest["keyFormat"]).toBeUndefined();
  });

  it("requires a non-blank authHeader (schema doesn't, but the wizard does)", () => {
    const draft = validDraft();
    draft.authHeader = "   ";
    const { errors } = evaluateDraft(draft);
    expect(errors.some((e) => /authHeader.*required/.test(e))).toBe(true);
  });

  it("trims and filters blank entries out of requiredEnv", () => {
    const draft = validDraft();
    draft.requiredEnv = ["  A  ", "", "  ", "B"];
    expect(evaluateDraft(draft).manifest["requiredEnv"]).toEqual(["A", "B"]);
  });
});

describe("toDraft field mapping", () => {
  it("maps a keyFormat object into an enabled, fully-populated draft keyFormat", () => {
    const d = toDraft({ keyFormat: { scheme: "bearer", env: ["T"], header: "Authorization", pattern: "^x$" } });
    expect(d.keyFormat).toEqual({ enabled: true, scheme: "bearer", env: ["T"], header: "Authorization", pattern: "^x$" });
  });

  it("defaults a partial keyFormat's missing fields to blanks (still enabled)", () => {
    const d = toDraft({ keyFormat: {} });
    expect(d.keyFormat).toEqual({ enabled: true, scheme: "", env: [], header: "", pattern: "" });
  });

  it("keeps the blank-draft keyFormat (disabled) when the file has none", () => {
    expect(toDraft({}).keyFormat).toEqual({ enabled: false, scheme: "", env: [], header: "", pattern: "" });
  });

  it("coerces capability values to booleans and preserves unknown keys", () => {
    const d = toDraft({ capabilities: { issues: 1, scheduling: 0, custom: "yes" } });
    expect(d.capabilities.issues).toBe(true);
    expect(d.capabilities.scheduling).toBe(false);
    expect(d.capabilities["custom"]).toBe(true);
  });

  it("ignores action keys that aren't contract actions and maps a full ActionMapping", () => {
    const d = toDraft({
      actions: {
        not_a_contract_action: { method: "GET", url: "x" },
        create_issue: { kind: "httpRequest", method: "POST", url: "u", body: "b", credentialType: "c", node: "n", typeVersion: 3, parameters: { a: 1 }, note: "hi" },
      },
    });
    expect((d.actions as Record<string, unknown>)["not_a_contract_action"]).toBeUndefined();
    expect(d.actions.create_issue).toEqual({
      enabled: true, kind: "httpRequest", method: "POST", url: "u", body: "b", credentialType: "c", node: "n",
      typeVersion: "3", parameters: '{\n  "a": 1\n}', note: "hi",
    });
  });

  it("maps an ActionMapping with all fields absent to blank strings (empty parameters/typeVersion)", () => {
    const d = toDraft({ actions: { list_projects: {} } });
    expect(d.actions.list_projects).toEqual({
      enabled: true, kind: "", method: "", url: "", body: "", credentialType: "", node: "", typeVersion: "", parameters: "", note: "",
    });
  });

  it("filters non-string entries out of requiredEnv and defaults a non-array to empty", () => {
    expect(toDraft({ requiredEnv: ["A", 3, null, "B"] }).requiredEnv).toEqual(["A", "B"]);
    expect(toDraft({ requiredEnv: "not-an-array" }).requiredEnv).toEqual([]);
  });

  it("keeps a valid kind and drops an invalid one", () => {
    expect(toDraft({ kind: "database" }).kind).toBe("database");
    expect(toDraft({ kind: "nonsense" }).kind).toBe("");
  });

  it("ignores non-object capabilities/actions blobs", () => {
    const d = toDraft({ capabilities: "nope", actions: 42 });
    expect(Object.values(d.capabilities).every((v) => v === false)).toBe(true);
    expect(Object.values(d.actions).every((a) => a.enabled === false)).toBe(true);
  });
});

describe("downloadBackendManifest", () => {
  function captureDownload() {
    const downloads: string[] = [];
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    return { downloads, restore: () => { spy.mockRestore(); vi.unstubAllGlobals(); } };
  }

  it("names the file <id>.json when the manifest has an id", () => {
    const { downloads, restore } = captureDownload();
    try {
      downloadBackendManifest({ id: "my-tool" });
      expect(downloads).toEqual(["my-tool.json"]);
    } finally {
      restore();
    }
  });

  it("falls back to backend.json when the id is blank or missing", () => {
    const { downloads, restore } = captureDownload();
    try {
      downloadBackendManifest({ id: "" });
      downloadBackendManifest({});
      expect(downloads).toEqual(["backend.json", "backend.json"]);
    } finally {
      restore();
    }
  });
});
