import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { raciQueryKey, type RaciEntry } from "../../lib/raci";
import { RaciAdmin } from "./RaciAdmin";

function seed(role: string | undefined, raci: RaciEntry[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(raciQueryKey, raci);
  return qc;
}
afterEach(() => vi.restoreAllMocks());

describe("RaciAdmin", () => {
  it("hides below manager", () => {
    renderWithProviders(<RaciAdmin />, { client: seed("contributor") });
    expect(screen.queryByTestId("raci-admin")).not.toBeInTheDocument();
  });
  it("PUTs a cleaned entry", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<RaciAdmin />, { client: seed("manager") });
    fireEvent.click(screen.getByTestId("raci-add"));
    fireEvent.change(screen.getByLabelText("Entry 1 task"), { target: { value: "Deploy" } });
    fireEvent.change(screen.getByLabelText("Entry 1 role"), { target: { value: "Ops" } });
    fireEvent.click(screen.getByTestId("raci-save"));
    const put = await waitFor(() => { const c = f.mock.calls.find(([u, i]) => u === "/api/raci" && (i as RequestInit)?.method === "PUT"); expect(c).toBeTruthy(); return c!; });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { raci: RaciEntry[] };
    expect(body.raci[0]).toMatchObject({ task: "Deploy", role: "Ops", responsibility: "R" });
  });
});
