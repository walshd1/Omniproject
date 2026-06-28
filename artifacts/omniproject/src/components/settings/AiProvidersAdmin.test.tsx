import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { AiProvidersAdmin } from "./AiProvidersAdmin";
import type { AiProvidersView } from "../../lib/ai-providers";

/** AI Providers admin: admin-only; vault-backed keys are write-only (never shown). */
const VIEW: AiProvidersView = {
  providers: [
    { id: "openai", kind: "openai", label: "OpenAI", hasKey: false, fingerprint: null, ready: false },
    { id: "ollama", kind: "ollama", label: "Ollama (local)", hasKey: false, fingerprint: null, ready: true },
    { id: "whisper", kind: "whisper", label: "Whisper", hasKey: false, fingerprint: null, ready: false },
  ],
  mapping: { chat: ["ollama"] },
  kinds: ["openai", "anthropic", "ollama", "openrouter", "whisper"],
  capabilities: [
    { id: "chat", label: "AI chat", surface: "chat" },
    { id: "stt", label: "Speech-to-text (Whisper)", surface: "stt" },
  ],
};

function seed(role: string | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(["ai-providers"], VIEW);
  return qc;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  // A GET refetch of the registry returns the view; step-up + writes resolve ok.
  fetchMock = vi.fn((url: string, init?: { method?: string }) => {
    const isGet = !init?.method || init.method === "GET";
    if (isGet && String(url).endsWith("/api/ai/providers")) return Promise.resolve({ ok: true, json: () => Promise.resolve(VIEW) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("AiProvidersAdmin", () => {
  it("is hidden for a non-admin", () => {
    renderWithProviders(<AiProvidersAdmin />, { client: seed("viewer") });
    expect(screen.queryByTestId("ai-providers-admin")).not.toBeInTheDocument();
  });

  it("shows providers with readiness and never renders a key value", () => {
    renderWithProviders(<AiProvidersAdmin />, { client: seed("admin") });
    expect(screen.getByTestId("ai-providers-admin")).toBeInTheDocument();
    expect(screen.getByText("openai · openai")).toBeInTheDocument();
    // The key field is a password input with no value (write-only).
    const input = screen.getByTestId("key-input-openai") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.value).toBe("");
  });

  it("stores a key via PUT to the vault endpoint after step-up", async () => {
    renderWithProviders(<AiProvidersAdmin />, { client: seed("admin") });
    fireEvent.change(screen.getByTestId("key-input-openai"), { target: { value: "sk-secret" } });
    fireEvent.click(screen.getByTestId("key-save-openai"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/ai/providers/openai/key"));
      expect(call).toBeTruthy();
      expect((call![1] as { method: string }).method).toBe("PUT");
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ key: "sk-secret" });
    });
    // step-up was requested first.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/auth/step-up"))).toBe(true);
  });

  it("maps a capability to a provider via PUT", async () => {
    renderWithProviders(<AiProvidersAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("map-chat-openai"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/ai/capabilities/chat"));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ providers: ["ollama", "openai"] });
    });
  });
});
