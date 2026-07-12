import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { programmeRegistryQueryKey, type ProgrammeRegistry } from "../../lib/programme-registry";
import { ProgrammeRegistryAdmin } from "./ProgrammeRegistryAdmin";

function seed(role: string | undefined, registry: ProgrammeRegistry): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(programmeRegistryQueryKey, registry);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("ProgrammeRegistryAdmin", () => {
  it("renders nothing below PMO (a plain manager)", () => {
    renderWithProviders(<ProgrammeRegistryAdmin />, { client: seed("manager", {}) });
    expect(screen.queryByTestId("programme-registry-admin")).not.toBeInTheDocument();
  });

  it("renders for a PMO and seeds rows from the server", () => {
    renderWithProviders(<ProgrammeRegistryAdmin />, { client: seed("pmo", { "prog-a": { name: "Alpha", instanceIds: ["g1", "g2"] } }) });
    expect(screen.getByLabelText("Programme 1 name")).toHaveValue("Alpha");
    expect(screen.getByLabelText("Programme 1 instance ids")).toHaveValue("g1, g2");
  });

  it("disables Save on a duplicate programme id", () => {
    renderWithProviders(<ProgrammeRegistryAdmin />, { client: seed("admin", {}) });
    fireEvent.click(screen.getByTestId("programme-add"));
    fireEvent.click(screen.getByTestId("programme-add"));
    fireEvent.change(screen.getByLabelText("Programme 1 id"), { target: { value: "dup" } });
    fireEvent.change(screen.getByLabelText("Programme 2 id"), { target: { value: "dup" } });
    expect(screen.getByTestId("programme-save")).toBeDisabled();
  });

  it("PUTs the registry (name + deduped GUID list) to /api/programme-registry", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<ProgrammeRegistryAdmin />, { client: seed("pmo", {}) });
    fireEvent.click(screen.getByTestId("programme-add"));
    fireEvent.change(screen.getByLabelText("Programme 1 id"), { target: { value: "prog-a" } });
    fireEvent.change(screen.getByLabelText("Programme 1 name"), { target: { value: "Apollo" } });
    fireEvent.change(screen.getByLabelText("Programme 1 instance ids"), { target: { value: "g1, g2 , g2" } });
    fireEvent.click(screen.getByTestId("programme-save"));

    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(String(put[0])).toMatch(/\/programme-registry$/);
    expect(JSON.parse(String(put[1]?.body)).programmeRegistry).toEqual({ "prog-a": { name: "Apollo", instanceIds: ["g1", "g2"] } });
  });
});
