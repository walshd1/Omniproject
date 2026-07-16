import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { settingsQueryKey } from "../../lib/settings-query";
import { FormsAdmin } from "./FormsAdmin";
import type { FormDef } from "../../lib/forms";

/**
 * FormsAdmin — the visual builder for intake forms (admin/PMO). Covers RBAC gating, adding from a shipped
 * template, and persisting the org forms via PUT /api/forms.
 */
function seed(role: string | undefined, forms: FormDef[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(settingsQueryKey, { forms });
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("FormsAdmin", () => {
  it("renders nothing below PMO", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("manager") });
    expect(screen.queryByTestId("forms-admin")).not.toBeInTheDocument();
  });

  it("shows the builder for a PMO with an empty state", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("pmo") });
    expect(screen.getByTestId("forms-admin")).toBeInTheDocument();
    expect(screen.getByTestId("forms-empty")).toBeInTheDocument();
  });

  it("the field-type picker is driven by the shared store, grouped into subfolders", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("pmo") });
    fireEvent.click(screen.getByTestId("form-add-blank"));
    const typeSelect = screen.getByLabelText("Field 1 type");
    const options = Array.from(typeSelect.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(options).toEqual(expect.arrayContaining(["text", "select", "email", "url", "checkbox"]));
    // subfolders (text / numeric / temporal / choice / boolean) render as optgroups
    const groups = Array.from(typeSelect.querySelectorAll("optgroup")).map((g) => g.getAttribute("label"));
    expect(groups).toEqual(expect.arrayContaining(["text", "choice", "boolean"]));
  });

  it("adds a form from a template and saves it via PUT /api/forms", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<FormsAdmin />, { client: seed("admin") });
    // Pick the first template and add it.
    const sel = screen.getByTestId("form-template-select") as HTMLSelectElement;
    const firstValue = Array.from(sel.querySelectorAll("option")).map((o) => o.value).find((v) => v !== "")!;
    fireEvent.change(sel, { target: { value: firstValue } });
    fireEvent.click(screen.getByTestId("form-add-template"));
    // The added form needs a target project before it validates for save.
    fireEvent.change(screen.getByLabelText("Form 1 target project"), { target: { value: "proj-001" } });
    fireEvent.click(screen.getByTestId("forms-save"));
    const put = await waitFor(() => {
      const c = fetchMock.mock.calls.find(([u, i]) => u === "/api/forms" && (i as RequestInit)?.method === "PUT");
      expect(c).toBeTruthy();
      return c!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { forms: FormDef[] };
    expect(body.forms).toHaveLength(1);
    expect(body.forms[0]!.target.projectId).toBe("proj-001");
    expect(body.forms[0]!.fields.length).toBeGreaterThan(0);
  });
});
