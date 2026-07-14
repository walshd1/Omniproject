import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor, renderHook } from "@testing-library/react";
import { useToast } from "@/hooks/use-toast";
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
  { id: "provider:ollama", kind: "ai-provider", label: "AI provider — ollama", description: "Local LLM", supportedStates: ["user-defined"], surfaceAware: true, options: ["off", "user-defined"], state: "user-defined", endpoint: "http://localhost:11434", surfaces: {} },
];

function seed(role: string | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(["governance"], { capabilities: CAPS, surfaces: [{ id: "reports", label: "Reports" }, { id: "projects", label: "Projects" }] });
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

  it("tests a user-defined endpoint and reports reachability", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).includes("/test") ? { reachable: true, status: 200 } : { capabilities: CAPS, surfaces: [] }),
      }),
    );
    renderWithProviders(<GovernanceAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(screen.getByTestId("endpoint-result-provider:ollama")).toHaveTextContent(/Reachable/));
    const testCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/test"));
    expect(testCall).toBeTruthy();
  });

  it("shows an AI tool's per-surface override and a registry-backed screen picker", () => {
    renderWithProviders(<GovernanceAdmin />, { client: seed("admin") });
    // The existing 'finance' override (an id with no registry label) shows as-is...
    expect(screen.getByText("finance")).toBeInTheDocument();
    // ...and new overrides are PICKED from the screen registry, not typed.
    expect(screen.getAllByLabelText("Add a screen override").length).toBeGreaterThan(0);
  });

  it("renders nothing when the governance data has no capabilities yet", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(["auth", "me"], { sub: "u1", role: "admin" });
    qc.setQueryData(["governance"], {}); // resolved but empty
    renderWithProviders(<GovernanceAdmin />, { client: qc });
    expect(screen.queryByTestId("governance-admin")).not.toBeInTheDocument();
  });

  it("aborts the save (no PUT) when the step-up re-auth is declined", async () => {
    // Deny the step-up: its POST comes back non-ok, so save() returns before any PUT.
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: !String(url).includes("/auth/step-up"),
        status: String(url).includes("/auth/step-up") ? 401 : 200,
        json: () => Promise.resolve({ capabilities: CAPS }),
      }),
    );
    renderWithProviders(<GovernanceAdmin />, { client: seed("admin") });
    fireEvent.change(screen.getByLabelText("AI provider — openai"), { target: { value: "public" } });
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/auth/step-up"))).toBe(true));
    // The gated PUT never fires.
    expect(fetchMock.mock.calls.some((c) => (c[1] as { method?: string })?.method === "PUT")).toBe(false);
  });

  it("surfaces a destructive toast when saving a capability fails", async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      const isPut = u.includes("/api/governance/") && !u.includes("/test");
      return Promise.resolve({
        ok: u.includes("/auth/step-up") ? true : !isPut,
        status: isPut ? 500 : 200,
        json: () => Promise.resolve({ capabilities: CAPS }),
      });
    });
    const { result } = renderHook(() => useToast());
    renderWithProviders(<GovernanceAdmin />, { client: seed("admin") });
    fireEvent.change(screen.getByLabelText("AI provider — openai"), { target: { value: "public" } });
    await waitFor(() => expect(result.current.toasts.some((t) => t.title === "Couldn't save that" && t.variant === "destructive")).toBe(true));
  });

  it("reports an unreachable user-defined endpoint in red", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).includes("/test") ? { reachable: false, error: "ECONNREFUSED" } : { capabilities: CAPS, surfaces: [] }),
      }),
    );
    renderWithProviders(<GovernanceAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    const result = await screen.findByTestId("endpoint-result-provider:ollama");
    expect(result).toHaveTextContent(/Unreachable: ECONNREFUSED/);
  });

  it("saves a changed endpoint on blur", async () => {
    renderWithProviders(<GovernanceAdmin />, { client: seed("admin") });
    const input = screen.getByLabelText("Your endpoint") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "http://localhost:9999" } });
    fireEvent.blur(input);
    const put = () => fetchMock.mock.calls.find((c) => (c[1] as { method?: string })?.method === "PUT" && decodeURIComponent(String(c[0])).includes("provider:ollama"));
    await waitFor(() => expect(put()).toBeTruthy());
    expect(JSON.parse((put()![1] as { body: string }).body).endpoint).toBe("http://localhost:9999");
  });

  it("does not save the endpoint on blur when it is unchanged", async () => {
    renderWithProviders(<GovernanceAdmin />, { client: seed("admin") });
    const input = screen.getByLabelText("Your endpoint") as HTMLInputElement;
    fireEvent.blur(input); // value still equals cap.endpoint
    // Give any (unwanted) async save a tick to fire.
    await Promise.resolve();
    expect(fetchMock.mock.calls.some((c) => (c[1] as { method?: string })?.method === "PUT")).toBe(false);
  });

  it("removes a per-surface override, PUTing the surface map without it", async () => {
    renderWithProviders(<GovernanceAdmin />, { client: seed("admin") });
    // The tts capability has a 'finance' override; remove it.
    fireEvent.click(screen.getByRole("button", { name: "remove" }));
    const put = () => fetchMock.mock.calls.find((c) => (c[1] as { method?: string })?.method === "PUT" && String(c[0]).includes("tts"));
    await waitFor(() => expect(put()).toBeTruthy());
    expect(JSON.parse((put()![1] as { body: string }).body).surfaces).toEqual({});
  });

  it("adds a per-surface override from the screen picker via the form", async () => {
    renderWithProviders(<GovernanceAdmin />, { client: seed("admin") });
    // tts is the first surface-aware capability (openai isn't; ollama also is, hence scope to the first).
    const picker = screen.getAllByLabelText("Add a screen override")[0]!;
    fireEvent.change(picker, { target: { value: "projects" } });
    // Submit the add form the picker belongs to.
    const form = picker.closest("form")!;
    fireEvent.submit(form);
    const put = () => fetchMock.mock.calls.find((c) => (c[1] as { method?: string })?.method === "PUT" && String(c[0]).includes("tts"));
    await waitFor(() => expect(put()).toBeTruthy());
    const body = JSON.parse((put()![1] as { body: string }).body);
    expect(body.surfaces).toHaveProperty("projects");
    expect(body.surfaces.finance).toBe("off"); // existing override preserved
  });
});
