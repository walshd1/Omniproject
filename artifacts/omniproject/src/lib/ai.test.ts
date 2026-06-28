import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAiStatus, aiChat, type AiStatus, type ChatMessage } from "./ai";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("fetchAiStatus", () => {
  it("requests the status endpoint with credentials and returns the body", async () => {
    const status: AiStatus = {
      provider: "anthropic",
      model: "claude-opus-4-8",
      configured: true,
      detail: "ready",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchAiStatus()).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith("/api/ai/status", { credentials: "same-origin" });
  });

  it("throws including the status code on a non-ok response", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, { ok: false, status: 503 })) as unknown as typeof fetch;
    await expect(fetchAiStatus()).rejects.toThrow("ai status failed: 503");
  });
});

describe("aiChat", () => {
  const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

  it("POSTs messages and returns the completion", async () => {
    const payload = { content: "hello", provider: "anthropic", model: "claude-opus-4-8" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(aiChat(messages)).resolves.toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/ai/chat");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    // Body carries the messages plus the current screen (surface) for governance.
    expect(JSON.parse(init.body).messages).toEqual(messages);
  });

  it("throws the server-provided error message on failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "rate limited" }, { ok: false, status: 429 })) as unknown as typeof fetch;
    await expect(aiChat(messages)).rejects.toThrow("rate limited");
  });

  it("falls back to a generic message when the error body is unparseable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("bad json");
      },
    }) as unknown as typeof fetch;
    await expect(aiChat(messages)).rejects.toThrow("ai chat failed: 500");
  });
});
