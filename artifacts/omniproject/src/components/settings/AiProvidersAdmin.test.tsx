import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor, renderHook } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { useToast } from "@/hooks/use-toast";
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

  it("unmaps a capability from a provider it's already mapped to", async () => {
    renderWithProviders(<AiProvidersAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("map-chat-ollama")); // ollama is already in mapping.chat
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/ai/capabilities/chat"));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ providers: [] });
    });
  });

  it("renders nothing until the providers/capabilities data has loaded", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    qc.setQueryData(["auth", "me"], { sub: "u1", role: "admin" });
    // No ["ai-providers"] data seeded — data is still undefined.
    renderWithProviders(<AiProvidersAdmin />, { client: qc });
    expect(screen.queryByTestId("ai-providers-admin")).not.toBeInTheDocument();
  });

  it("does nothing when Save is clicked with an empty key", async () => {
    renderWithProviders(<AiProvidersAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("key-save-openai"));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/auth/step-up"))).toBe(true));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/ai/providers/openai/key"))).toBe(false);
  });

  it("shows an error toast when saving a key fails", async () => {
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      const isGet = !init?.method || init.method === "GET";
      if (isGet && String(url).endsWith("/api/ai/providers")) return Promise.resolve({ ok: true, json: () => Promise.resolve(VIEW) });
      if (String(url).includes("/api/ai/providers/openai/key")) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: "vault down" }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    const { result } = renderHook(() => useToast());
    renderWithProviders(<AiProvidersAdmin />, { client: seed("admin") });
    fireEvent.change(screen.getByTestId("key-input-openai"), { target: { value: "sk-secret" } });
    fireEvent.click(screen.getByTestId("key-save-openai"));
    await waitFor(() => expect(result.current.toasts.some((t) => t.title === "Couldn't save that")).toBe(true));
  });

  it("clears a stored key and removes a provider", async () => {
    const view: AiProvidersView = { ...VIEW, providers: [{ ...VIEW.providers[0]!, hasKey: true, fingerprint: "ab12" }, ...VIEW.providers.slice(1)] };
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      const isGet = !init?.method || init.method === "GET";
      if (isGet && String(url).endsWith("/api/ai/providers")) return Promise.resolve({ ok: true, json: () => Promise.resolve(view) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    qc.setQueryData(["auth", "me"], { sub: "u1", role: "admin" });
    qc.setQueryData(["ai-providers"], view);
    renderWithProviders(<AiProvidersAdmin />, { client: qc });

    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/ai/providers/openai/key") && (c[1] as { method?: string })?.method === "DELETE");
      expect(call).toBeTruthy();
    });

    fireEvent.click(screen.getAllByRole("button", { name: /^remove$/i })[0]!);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/ai/providers/openai") && !String(c[0]).includes("/key") && (c[1] as { method?: string })?.method === "DELETE");
      expect(call).toBeTruthy();
    });
  });

  it("adds a new provider via the Add-provider form", async () => {
    renderWithProviders(<AiProvidersAdmin />, { client: seed("admin") });
    const addBtn = screen.getByTestId("add-provider");
    expect(addBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId("add-id"), { target: { value: "openai-team" } });
    fireEvent.change(screen.getByTestId("add-kind"), { target: { value: "anthropic" } });
    fireEvent.change(screen.getByTestId("add-label"), { target: { value: "Team OpenAI" } });
    fireEvent.change(screen.getByPlaceholderText("endpoint (optional)"), { target: { value: "https://api.example.com" } });
    fireEvent.change(screen.getByPlaceholderText("model (optional)"), { target: { value: "gpt-5" } });
    expect(addBtn).toBeEnabled();

    fireEvent.click(addBtn);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/api/ai/providers") && (c[1] as { method?: string })?.method === "POST");
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({
        id: "openai-team", kind: "anthropic", label: "Team OpenAI", endpoint: "https://api.example.com", model: "gpt-5",
      });
    });
    // Form resets after a successful add.
    expect((screen.getByTestId("add-id") as HTMLInputElement).value).toBe("");
  });

  it("shows the rotate badge for a stale key, and the vault backend note", () => {
    const view: AiProvidersView = {
      ...VIEW,
      providers: [{ ...VIEW.providers[0]!, hasKey: true, stale: true, ageDays: 120 }, ...VIEW.providers.slice(1)],
      vault: { backend: "local", backends: ["local"] },
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    qc.setQueryData(["auth", "me"], { sub: "u1", role: "admin" });
    qc.setQueryData(["ai-providers"], view);
    renderWithProviders(<AiProvidersAdmin />, { client: qc });
    expect(screen.getByTestId("stale-openai")).toHaveAttribute("title", "Key is 120 days old — rotate it");
    expect(screen.getByTestId("vault-backend")).toHaveTextContent("local");
  });
});
