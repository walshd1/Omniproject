import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { settingsQueryKey } from "../../lib/settings-query";
import { AutomationsAdmin } from "./AutomationsAdmin";
import type { Automation } from "../../lib/automations";

/** The automation recipe builder (PMO/admin). RBAC gating, add + save, and the live preview call. */
function seed(role: string | undefined, automations: Automation[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(settingsQueryKey, { automations });
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("AutomationsAdmin", () => {
  it("renders nothing below PMO", () => {
    renderWithProviders(<AutomationsAdmin />, { client: seed("manager") });
    expect(screen.queryByTestId("automations-admin")).not.toBeInTheDocument();
  });

  it("adds a recipe and saves it via PUT /api/automations", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<AutomationsAdmin />, { client: seed("pmo") });
    expect(screen.getByTestId("automations-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("automation-add"));
    fireEvent.click(screen.getByTestId("automations-save"));
    const put = await waitFor(() => {
      const c = fetchMock.mock.calls.find(([u, i]) => u === "/api/automations" && (i as RequestInit)?.method === "PUT");
      expect(c).toBeTruthy();
      return c!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { automations: Automation[] };
    expect(body.automations).toHaveLength(1);
    expect(body.automations[0]!.trigger.kind).toBe("issue.created");
    expect(body.automations[0]!.actions[0]!.kind).toBe("notify");
  });

  it("previews a draft recipe (POST /api/automations/preview) and shows the verdict", async () => {
    // A fresh Response per call — its body can only be read once, and a CSRF prefetch may consume the first.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ workflow: { id: "recipe:recipe", steps: [{}] }, requirements: [{ kind: "inform" }], mutates: false, canAuthor: true }), { status: 200 }),
    ));
    renderWithProviders(<AutomationsAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("automation-add"));
    fireEvent.click(screen.getByTestId("automation-preview-recipe"));
    await waitFor(() => expect(screen.getByTestId("automation-preview-result-recipe").textContent).toContain("you can run this"));
    expect(fetchMock.mock.calls.some(([u, i]) => u === "/api/automations/preview" && (i as RequestInit)?.method === "POST")).toBe(true);
  });
});
