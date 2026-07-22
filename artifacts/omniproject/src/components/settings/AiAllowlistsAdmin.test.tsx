import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { AiAllowlistsAdmin } from "./AiAllowlistsAdmin";
import { aiProviderAllowlistKey, aiModelAllowlistKey, sttProviderAllowlistKey } from "../../lib/ai-allowlist-api";

// The panel reads/writes the three `*-allowlist` config defs (Phase C). Seed each query cache directly.
function seeded(opts: { provider?: string[] | null; model?: string[] | null; stt?: string[] | null; role?: string } = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, mode: "demo", user: { sub: "u1" }, role: opts.role ?? "admin" });
  qc.setQueryData(aiProviderAllowlistKey, { aiProviderAllowlist: opts.provider ?? null });
  qc.setQueryData(aiModelAllowlistKey, { aiModelAllowlist: opts.model ?? null });
  qc.setQueryData(sttProviderAllowlistKey, { sttProviderAllowlist: opts.stt ?? null });
  return qc;
}

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("AiAllowlistsAdmin", () => {
  it("renders nothing for a non-admin", () => {
    const { container } = renderWithProviders(<AiAllowlistsAdmin />, { client: seeded({ role: "viewer" }) });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows all three sections, unrestricted by default", () => {
    renderWithProviders(<AiAllowlistsAdmin />, { client: seeded() });
    expect(screen.getByTestId("allowlist-provider")).toBeInTheDocument();
    expect(screen.getByTestId("allowlist-model")).toBeInTheDocument();
    expect(screen.getByTestId("allowlist-stt")).toBeInTheDocument();
    // Unrestricted ⇒ no option checkboxes yet.
    expect(screen.queryByTestId("provider-openai")).not.toBeInTheDocument();
  });

  it("ticking Restrict on the provider section PUTs [] to /api/ai/provider-allowlist", async () => {
    const calls = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson({ aiProviderAllowlist: [] }));
    renderWithProviders(<AiAllowlistsAdmin />, { client: seeded() });
    fireEvent.click(screen.getByTestId("provider-restrict"));
    await waitFor(() => {
      const call = calls.mock.calls.find(([url, init]) => String(url).includes("/api/ai/provider-allowlist") && init?.method === "PUT");
      expect(JSON.parse(String(call![1]?.body))).toEqual({ aiProviderAllowlist: [] });
    });
  });

  it("ticking Restrict on the STT section PUTs [] to /api/ai/stt-provider-allowlist", async () => {
    const calls = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson({ sttProviderAllowlist: [] }));
    renderWithProviders(<AiAllowlistsAdmin />, { client: seeded() });
    fireEvent.click(screen.getByTestId("stt-restrict"));
    await waitFor(() => {
      const call = calls.mock.calls.find(([url, init]) => String(url).includes("/api/ai/stt-provider-allowlist") && init?.method === "PUT");
      expect(JSON.parse(String(call![1]?.body))).toEqual({ sttProviderAllowlist: [] });
    });
  });

  it("adding a model PUTs the appended list to /api/ai/model-allowlist", async () => {
    const calls = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson({ aiModelAllowlist: ["gpt-4o"] }));
    renderWithProviders(<AiAllowlistsAdmin />, { client: seeded({ model: [] }) });
    fireEvent.change(screen.getByTestId("model-add-input"), { target: { value: "gpt-4o" } });
    fireEvent.click(screen.getByTestId("model-add"));
    await waitFor(() => {
      const call = calls.mock.calls.find(([url, init]) => String(url).includes("/api/ai/model-allowlist") && init?.method === "PUT");
      expect(JSON.parse(String(call![1]?.body))).toEqual({ aiModelAllowlist: ["gpt-4o"] });
    });
  });

  it("shows the ticked providers when the provider allowlist is set", () => {
    renderWithProviders(<AiAllowlistsAdmin />, { client: seeded({ provider: ["anthropic"] }) });
    expect((screen.getByTestId("provider-anthropic") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("provider-openai") as HTMLInputElement).checked).toBe(false);
  });
});
