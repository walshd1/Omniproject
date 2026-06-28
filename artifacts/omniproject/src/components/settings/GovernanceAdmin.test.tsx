import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { GovernanceAdmin } from "./GovernanceAdmin";
import type { ResolvedCapability } from "../../lib/tools";

/**
 * The governance card: admin-only; shows only each capability's supported states; and
 * persists a change (incl. per-surface AI overrides) via PUT.
 */
const CAPS: ResolvedCapability[] = [
  { id: "tts", kind: "ai-tool", label: "Text-to-speech", description: "Read aloud", supportedStates: ["user-defined", "public"], surfaceAware: true, options: ["off", "user-defined", "public"], state: "public", endpoint: null, surfaces: { finance: "off" } },
  { id: "provider:openai", kind: "ai-provider", label: "AI provider — openai", description: "Cloud LLM", supportedStates: ["public"], surfaceAware: false, options: ["off", "public"], state: "off", endpoint: null, surfaces: {} },
];

function seed(role: string | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(["governance"], { capabilities: CAPS });
  return qc;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ capabilities: CAPS }) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("GovernanceAdmin", () => {
  it("renders nothing for a non-admin", () => {
    renderWithProviders(<GovernanceAdmin />, { client: seed("viewer") });
    expect(screen.queryByTestId("governance-admin")).not.toBeInTheDocument();
  });

  it("offers only the states a capability supports", () => {
    renderWithProviders(<GovernanceAdmin />, { client: seed("admin") });
    // The cloud-only provider offers just Off + Public (no User-defined).
    const select = screen.getByLabelText("AI provider — openai") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["off", "public"]);
  });

  it("persists a state change via PUT", async () => {
    renderWithProviders(<GovernanceAdmin />, { client: seed("admin") });
    fireEvent.change(screen.getByLabelText("AI provider — openai"), { target: { value: "public" } });
    const putCall = () => fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/governance/") && (c[1] as { method?: string })?.method === "PUT");
    await waitFor(() => expect(putCall()).toBeTruthy());
    const call = putCall()!;
    expect(decodeURIComponent(String(call[0]))).toBe("/api/governance/provider:openai");
    expect(JSON.parse((call[1] as { body: string }).body).state).toBe("public");
  });

  it("shows an AI tool's per-surface override (finance)", () => {
    renderWithProviders(<GovernanceAdmin />, { client: seed("admin") });
    expect(screen.getByText("finance")).toBeInTheDocument();
  });
});
