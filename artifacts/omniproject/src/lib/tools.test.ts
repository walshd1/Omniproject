import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EGRESS_INFO, consentToTool, revokeToolConsent, saveToolPolicy } from "./tools";

/**
 * Client tools helpers: egress copy completeness + the consent/policy fetch calls.
 */
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("EGRESS_INFO", () => {
  it("describes every egress class with a tone", () => {
    for (const cls of ["none", "self-hosted", "third-party"] as const) {
      expect(EGRESS_INFO[cls].label).toBeTruthy();
      expect(EGRESS_INFO[cls].blurb).toBeTruthy();
      expect(["safe", "caution", "warn"]).toContain(EGRESS_INFO[cls].tone);
    }
  });
});

describe("consent + policy calls", () => {
  it("POSTs consent for a tool", async () => {
    await consentToTool("whisper-dictation");
    expect(fetchMock).toHaveBeenCalledWith("/api/tools/whisper-dictation/consent", expect.objectContaining({ method: "POST" }));
  });
  it("DELETEs consent for a tool", async () => {
    await revokeToolConsent("portfolio-copilot");
    expect(fetchMock).toHaveBeenCalledWith("/api/tools/portfolio-copilot/consent", expect.objectContaining({ method: "DELETE" }));
  });
  it("PUTs the admin policy as JSON", async () => {
    await saveToolPolicy({ allowedEgress: ["none", "self-hosted"], disabled: [] });
    expect(fetchMock).toHaveBeenCalledWith("/api/tools/policy", expect.objectContaining({ method: "PUT" }));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.allowedEgress).toContain("self-hosted");
  });
});
