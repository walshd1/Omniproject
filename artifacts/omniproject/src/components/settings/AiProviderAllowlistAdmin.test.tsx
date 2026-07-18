import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { AiProviderAllowlistAdmin } from "./AiProviderAllowlistAdmin";
import { aiProviderAllowlistKey } from "../../lib/ai-allowlist-api";

// The panel reads/writes the `ai-provider-allowlist` config def at /api/ai/provider-allowlist (Phase C).
function seeded(allowlist: string[] | null, role = "admin"): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, mode: "demo", user: { sub: "u1" }, role });
  qc.setQueryData(aiProviderAllowlistKey, { aiProviderAllowlist: allowlist });
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("AiProviderAllowlistAdmin", () => {
  it("renders nothing for a non-admin", () => {
    const { container } = renderWithProviders(<AiProviderAllowlistAdmin />, { client: seeded(null, "viewer") });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows Unrestricted by default and no provider checkboxes until restricted", () => {
    renderWithProviders(<AiProviderAllowlistAdmin />, { client: seeded(null) });
    expect(screen.getByText("Unrestricted")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-allowlist-openai")).not.toBeInTheDocument();
  });

  it("shows Restricted + the ticked providers when an allowlist is set", () => {
    renderWithProviders(<AiProviderAllowlistAdmin />, { client: seeded(["anthropic"]) });
    expect(screen.getByText("Restricted")).toBeInTheDocument();
    expect((screen.getByTestId("ai-allowlist-anthropic") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("ai-allowlist-openai") as HTMLInputElement).checked).toBe(false);
  });

  it("ticking Restrict PUTs an empty allowlist ([]) to /api/ai/provider-allowlist", async () => {
    const calls = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ aiProviderAllowlist: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    renderWithProviders(<AiProviderAllowlistAdmin />, { client: seeded(null) });
    fireEvent.click(screen.getByTestId("ai-allowlist-restrict"));
    await waitFor(() => {
      const call = calls.mock.calls.find(([url, init]) => String(url).includes("/api/ai/provider-allowlist") && init?.method === "PUT");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]?.body))).toEqual({ aiProviderAllowlist: [] });
    });
  });

  it("Save PUTs the ticked provider set", async () => {
    const calls = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ aiProviderAllowlist: ["anthropic"] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    renderWithProviders(<AiProviderAllowlistAdmin />, { client: seeded(["anthropic"]) });
    fireEvent.click(screen.getByTestId("ai-allowlist-openai")); // add openai
    fireEvent.click(screen.getByTestId("ai-allowlist-save"));
    await waitFor(() => {
      const call = calls.mock.calls.find(([url, init]) => String(url).includes("/api/ai/provider-allowlist") && init?.method === "PUT");
      const body = JSON.parse(String(call![1]?.body));
      expect(body.aiProviderAllowlist).toEqual(expect.arrayContaining(["anthropic", "openai"]));
    });
  });
});
