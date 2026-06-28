import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { askCopilot } from "./copilot";

/** Read-only portfolio copilot client: POSTs the question + answer mode, surfaces errors. */
let originalFetch: typeof globalThis.fetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}

describe("askCopilot", () => {
  it("defaults to RAG mode and omits surface when not given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ answer: "ok", projects: 2 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(askCopilot("how are we doing?")).resolves.toEqual({ answer: "ok", projects: 2 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/ai/copilot");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ question: "how are we doing?", mode: "rag" });
    expect("surface" in body).toBe(false);
  });

  it("passes an explicit freeform mode and the surface, and returns the persona", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ answer: "risks", projects: 1, persona: { id: "risk-assurance-manager", title: "Risk & Assurance Manager" } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await askCopilot("top risks?", "/settings", "freeform");
    expect(r.persona?.title).toBe("Risk & Assurance Manager");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ question: "top risks?", mode: "freeform", surface: "/settings" });
  });

  it("throws the server-provided error message on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "AI is unavailable here" }, { ok: false, status: 403 })) as unknown as typeof fetch;
    await expect(askCopilot("x")).rejects.toThrow("AI is unavailable here");
  });

  it("falls back to a generic message when the error body is unparseable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500, json: async () => { throw new Error("bad json"); },
    }) as unknown as typeof fetch;
    await expect(askCopilot("x")).rejects.toThrow("Copilot failed (500)");
  });
});
