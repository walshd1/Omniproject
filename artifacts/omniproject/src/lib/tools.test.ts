import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { STATE_INFO, KIND_LABEL, saveCapability } from "./tools";

/**
 * Client governance helpers: state copy completeness + the admin save call.
 */
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("copy", () => {
  it("describes every deployment state and capability kind", () => {
    for (const s of ["off", "user-defined", "public"] as const) {
      expect(STATE_INFO[s].label).toBeTruthy();
      expect(["muted", "safe", "warn"]).toContain(STATE_INFO[s].tone);
    }
    for (const k of ["ai-tool", "mcp", "ai-provider", "vendor"] as const) {
      expect(KIND_LABEL[k]).toBeTruthy();
    }
  });
});

describe("saveCapability", () => {
  it("PUTs the capability setting as JSON", async () => {
    await saveCapability("tts", { state: "public", surfaces: { finance: "off" } });
    expect(fetchMock).toHaveBeenCalledWith("/api/governance/tts", expect.objectContaining({ method: "PUT" }));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.state).toBe("public");
    expect(body.surfaces.finance).toBe("off");
  });
});
