import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useAiProviders,
  upsertProvider,
  removeProvider,
  setProviderKey,
  clearProviderKey,
  setCapabilityProviders,
  type AiProvidersView,
} from "./ai-providers";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

const VIEW: AiProvidersView = {
  providers: [{ id: "p1", kind: "openai", label: "OpenAI", hasKey: true, fingerprint: "ab12", ready: true }],
  mapping: { chat: ["p1"] },
  kinds: ["openai", "anthropic", "ollama", "openrouter", "whisper"],
  capabilities: [{ id: "chat", label: "Chat", surface: "chat" }],
};

describe("useAiProviders", () => {
  it("fetches the provider registry (no secrets present)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(VIEW), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAiProviders(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("/api/ai/providers");
    expect(result.current.data).toEqual(VIEW);
  });
});

describe("upsertProvider", () => {
  it("POSTs the provider fields to the providers endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await upsertProvider({ id: "p1", kind: "anthropic", label: "Claude", endpoint: "https://api.anthropic.com", model: "claude" });
    const [url, opts] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/ai/providers");
    expect((opts as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({
      id: "p1", kind: "anthropic", label: "Claude", endpoint: "https://api.anthropic.com", model: "claude",
    });
  });

  it("throws the server's error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not admin" }), { status: 403, headers: { "Content-Type": "application/json" } })));
    await expect(upsertProvider({ id: "p1", kind: "openai", label: "OpenAI" })).rejects.toThrow("not admin");
  });

  it("maps a step_up_required code to that exact message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "step_up_required" }), { status: 403, headers: { "Content-Type": "application/json" } })));
    await expect(upsertProvider({ id: "p1", kind: "openai", label: "OpenAI" })).rejects.toThrow("step_up_required");
  });
});

describe("removeProvider", () => {
  it("DELETEs the provider by (URL-encoded) id", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await removeProvider("p 1/x");
    const [url, opts] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/ai/providers/p%201%2Fx");
    expect((opts as RequestInit).method).toBe("DELETE");
  });
});

describe("setProviderKey", () => {
  it("PUTs the key to the provider's key endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await setProviderKey("p1", "sk-secret");
    const [url, opts] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/ai/providers/p1/key");
    expect((opts as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ key: "sk-secret" });
  });
});

describe("clearProviderKey", () => {
  it("DELETEs the provider's stored key", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await clearProviderKey("p1");
    const [url, opts] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/ai/providers/p1/key");
    expect((opts as RequestInit).method).toBe("DELETE");
  });
});

describe("setCapabilityProviders", () => {
  it("PUTs the ordered provider list for a capability", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await setCapabilityProviders("chat", ["p1", "p2"]);
    const [url, opts] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/ai/capabilities/chat");
    expect((opts as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ providers: ["p1", "p2"] });
  });

  it("throws the server's error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unknown capability" }), { status: 400, headers: { "Content-Type": "application/json" } })));
    await expect(setCapabilityProviders("bogus", [])).rejects.toThrow("unknown capability");
  });
});
