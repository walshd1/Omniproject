import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  testBrokerConnection,
  fetchConfigExport,
  fetchBackends,
  downloadWorkflow,
  downloadSnapshot,
  restoreSnapshot,
  fetchEnvironments,
  createEnvironment,
  activateEnvironment,
  promoteEnvironment,
  markKnownGood,
  rollback,
  verifyWorkflow,
} from "./setup";

let originalFetch: typeof globalThis.fetch;

function res(body: unknown, init: { ok?: boolean; status?: number; blob?: Blob; text?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => init.text ?? JSON.stringify(body),
    blob: async () => init.blob ?? new Blob([JSON.stringify(body)], { type: "application/json" }),
  };
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  // URL object-url stubs for download helpers.
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => "blob:fake");
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("testBrokerConnection", () => {
  it("POSTs the candidate url and returns the parsed result", async () => {
    const result = { reachable: true, ok: true, status: 200, implementsCapabilities: true };
    const fetchMock = vi.fn().mockResolvedValue(res(result));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(testBrokerConnection("https://broker.example/webhook")).resolves.toEqual(result);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/setup/test-broker");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ webhookUrl: "https://broker.example/webhook" });
  });

  it("returns a graceful fallback when json parsing fails on a bad status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("no body");
      },
    }) as unknown as typeof fetch;
    await expect(testBrokerConnection("x")).resolves.toEqual({
      reachable: false,
      error: "request failed (502)",
    });
  });
});

describe("fetchConfigExport", () => {
  it("requests the chosen format and returns text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(null, { text: "KEY=value" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(fetchConfigExport("env")).resolves.toBe("KEY=value");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/setup/export?format=env",
      { credentials: "same-origin" },
    );
  });

  it("throws on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(res(null, { ok: false, status: 500 })) as unknown as typeof fetch;
    await expect(fetchConfigExport("compose")).rejects.toThrow("export failed: 500");
  });
});

describe("fetchBackends", () => {
  it("returns the backend list", async () => {
    const backends = [{ id: "plane", label: "Plane" }];
    globalThis.fetch = vi.fn().mockResolvedValue(res(backends)) as unknown as typeof fetch;
    await expect(fetchBackends()).resolves.toEqual(backends);
  });

  it("throws on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(res(null, { ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(fetchBackends()).rejects.toThrow("backends failed: 404");
  });
});

describe("downloadWorkflow (blob download)", () => {
  it("POSTs and triggers an anchor click with the expected filename", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const blob = new Blob(["{}"], { type: "application/json" });
    const fetchMock = vi.fn().mockResolvedValue(res(null, { blob }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await downloadWorkflow("openproject", "/hooks/op");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/setup/generate-workflow");
    expect(JSON.parse(init.body)).toEqual({ backendId: "openproject", webhookPath: "/hooks/op" });
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("throws the server error message when generation fails", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(res({ error: "unknown backend" }, { ok: false, status: 400 })) as unknown as typeof fetch;
    await expect(downloadWorkflow("nope")).rejects.toThrow("unknown backend");
  });
});

describe("downloadSnapshot", () => {
  it("fetches the snapshot and triggers a download", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue(res(null, { blob: new Blob(["{}"]) })) as unknown as typeof fetch;
    await downloadSnapshot();
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it("throws on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(res(null, { ok: false, status: 500 })) as unknown as typeof fetch;
    await expect(downloadSnapshot()).rejects.toThrow("snapshot failed: 500");
  });
});

describe("restoreSnapshot", () => {
  it("POSTs the snapshot and returns the result on success", async () => {
    const payload = { restored: true, warnings: ["minor"] };
    const fetchMock = vi.fn().mockResolvedValue(res(payload));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(restoreSnapshot({ any: "thing" })).resolves.toEqual(payload);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ any: "thing" });
  });

  it("throws the server error on a non-ok response", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(res({ error: "corrupt" }, { ok: false, status: 422 })) as unknown as typeof fetch;
    await expect(restoreSnapshot({})).rejects.toThrow("corrupt");
  });
});

describe("fetchEnvironments", () => {
  it("returns the store view", async () => {
    const store = { activeEnv: "dev", environments: ["dev"], versions: [], lastKnownGoodId: null, persisted: true };
    globalThis.fetch = vi.fn().mockResolvedValue(res(store)) as unknown as typeof fetch;
    await expect(fetchEnvironments()).resolves.toEqual(store);
  });

  it("throws on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(res(null, { ok: false, status: 500 })) as unknown as typeof fetch;
    await expect(fetchEnvironments()).rejects.toThrow("environments failed: 500");
  });
});

describe("postJson-backed helpers", () => {
  it("createEnvironment posts the name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ activeEnv: "x" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await createEnvironment("staging");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/setup/environments");
    expect(JSON.parse(init.body)).toEqual({ name: "staging" });
  });

  it("activateEnvironment posts the name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await activateEnvironment("prod");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/setup/environments/activate");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "prod" });
  });

  it("promoteEnvironment posts from/to", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await promoteEnvironment("dev", "prod");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/setup/promote");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ from: "dev", to: "prod" });
  });

  it("markKnownGood targets the version id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await markKnownGood("v123");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/setup/versions/v123/known-good");
  });

  it("rollback posts the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ rolledBack: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await rollback({ toKnownGood: true });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/setup/rollback");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ toKnownGood: true });
  });

  it("propagates the server error message", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(res({ error: "duplicate env" }, { ok: false, status: 409 })) as unknown as typeof fetch;
    await expect(createEnvironment("dev")).rejects.toThrow("duplicate env");
  });

  it("falls back to a generic message when error body is missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("no body");
      },
    }) as unknown as typeof fetch;
    await expect(createEnvironment("dev")).rejects.toThrow("request failed: 500");
  });
});

describe("verifyWorkflow", () => {
  it("POSTs an empty body and returns the verify result", async () => {
    const result = {
      webhookUrl: "u",
      summary: { passed: 3, total: 3, verifyAware: true },
      results: [],
      note: "ok",
    };
    const fetchMock = vi.fn().mockResolvedValue(res(result));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(verifyWorkflow()).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/setup/verify-workflow");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
  });

  it("throws the server error message on failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(res({ error: "no webhook configured" }, { ok: false, status: 400 })) as unknown as typeof fetch;
    await expect(verifyWorkflow()).rejects.toThrow("no webhook configured");
  });
});
