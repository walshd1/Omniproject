import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { settingsQueryKey } from "../../lib/settings-query";
import { TemplatesAdmin } from "./TemplatesAdmin";
import type { Template } from "../../lib/templates";

/** The project-template gallery: RBAC gating, add-from-catalogue + save, and instantiate. */
function seed(role: string | undefined, templates: Template[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(settingsQueryKey, { templates });
  return qc;
}

const TEMPLATE: Template = { id: "scrum", label: "Scrum project", seedIssues: [{ title: "Sprint 0" }] };

afterEach(() => vi.restoreAllMocks());

describe("TemplatesAdmin", () => {
  it("renders nothing below manager", () => {
    renderWithProviders(<TemplatesAdmin />, { client: seed("contributor") });
    expect(screen.queryByTestId("templates-admin")).not.toBeInTheDocument();
  });

  it("a PMO adds a template from the catalogue and saves it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<TemplatesAdmin />, { client: seed("admin") });
    const sel = screen.getByTestId("template-catalogue-select") as HTMLSelectElement;
    const first = Array.from(sel.querySelectorAll("option")).map((o) => o.value).find((v) => v !== "")!;
    fireEvent.change(sel, { target: { value: first } });
    fireEvent.click(screen.getByTestId("template-add-catalogue"));
    fireEvent.click(screen.getByTestId("templates-save"));
    const put = await waitFor(() => {
      const c = fetchMock.mock.calls.find(([u, i]) => u === "/api/templates" && (i as RequestInit)?.method === "PUT");
      expect(c).toBeTruthy();
      return c!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { templates: Template[] };
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0]!.seedIssues!.length).toBeGreaterThan(0);
  });

  it("a manager instantiates a saved template (POST /instantiate)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ project: { id: "p9", name: "Apollo" }, seeded: 1 }), { status: 201 }),
    ));
    renderWithProviders(<TemplatesAdmin />, { client: seed("manager", [TEMPLATE]) });
    fireEvent.change(screen.getByTestId("template-name-scrum"), { target: { value: "Apollo" } });
    fireEvent.click(screen.getByTestId("template-use-scrum"));
    await waitFor(() => {
      const c = fetchMock.mock.calls.find(([u, i]) => u === "/api/templates/scrum/instantiate" && (i as RequestInit)?.method === "POST");
      expect(c).toBeTruthy();
    });
  });
});
