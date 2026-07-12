import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { guidAliasesQueryKey, type GuidAliases } from "../../lib/guid-aliases";
import { GuidAliasesAdmin } from "./GuidAliasesAdmin";

function seed(role: string | undefined, aliases: GuidAliases): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(guidAliasesQueryKey, aliases);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("GuidAliasesAdmin", () => {
  it("renders nothing below PMO/admin", () => {
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("manager", {}) });
    expect(screen.queryByTestId("guid-aliases-admin")).not.toBeInTheDocument();
  });

  it("disables Save when a relink points a GUID at itself", () => {
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("admin", {}) });
    fireEvent.click(screen.getByTestId("guid-alias-add"));
    fireEvent.change(screen.getByLabelText("Alias 1 old"), { target: { value: "same" } });
    fireEvent.change(screen.getByLabelText("Alias 1 new"), { target: { value: "same" } });
    expect(screen.getByTestId("guid-alias-save")).toBeDisabled();
  });

  it("PUTs a relink to /api/guid-aliases", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("pmo", {}) });
    fireEvent.click(screen.getByTestId("guid-alias-add"));
    fireEvent.change(screen.getByLabelText("Alias 1 old"), { target: { value: "old" } });
    fireEvent.change(screen.getByLabelText("Alias 1 new"), { target: { value: "new" } });
    fireEvent.click(screen.getByTestId("guid-alias-save"));

    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(String(put[0])).toMatch(/\/guid-aliases$/);
    expect(JSON.parse(String(put[1]?.body)).guidAliases).toEqual({ old: "new" });
  });

  it("forgets a project via DELETE /api/projects/:guid/links", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ guid: "g1", removedFromClosed: true, removedFromProgrammes: [], removedAliases: 0 }), { status: 200 }));
    renderWithProviders(<GuidAliasesAdmin />, { client: seed("admin", {}) });
    fireEvent.change(screen.getByTestId("guid-forget-input"), { target: { value: "g1" } });
    fireEvent.click(screen.getByTestId("guid-forget-btn"));

    const del = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(String(del[0])).toMatch(/\/projects\/g1\/links$/);
  });
});
