import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { closedProjectsQueryKey, type ClosedProjectRegistry } from "../../lib/closed-projects";
import { ClosedProjectsAdmin } from "./ClosedProjectsAdmin";

function seed(role: string | undefined, reg: ClosedProjectRegistry): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(closedProjectsQueryKey, reg);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("ClosedProjectsAdmin", () => {
  it("renders nothing below PMO/admin", () => {
    renderWithProviders(<ClosedProjectsAdmin />, { client: seed("manager", {}) });
    expect(screen.queryByTestId("closed-projects-admin")).not.toBeInTheDocument();
  });

  it("seeds rows from the server for a PMO", () => {
    renderWithProviders(<ClosedProjectsAdmin />, { client: seed("pmo", { "guid-1": { disposition: "archive", source: "jira" } }) });
    expect(screen.getByLabelText("Closed project 1 guid")).toHaveValue("guid-1");
    expect(screen.getByLabelText("Closed project 1 disposition")).toHaveValue("archive");
  });

  it("disables Save on a duplicate GUID", () => {
    renderWithProviders(<ClosedProjectsAdmin />, { client: seed("admin", {}) });
    fireEvent.click(screen.getByTestId("closed-project-add"));
    fireEvent.click(screen.getByTestId("closed-project-add"));
    fireEvent.change(screen.getByLabelText("Closed project 1 guid"), { target: { value: "dup" } });
    fireEvent.change(screen.getByLabelText("Closed project 2 guid"), { target: { value: "dup" } });
    expect(screen.getByTestId("closed-project-save")).toBeDisabled();
  });

  it("PUTs the registry to /api/closed-projects", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<ClosedProjectsAdmin />, { client: seed("pmo", {}) });
    fireEvent.click(screen.getByTestId("closed-project-add"));
    fireEvent.change(screen.getByLabelText("Closed project 1 guid"), { target: { value: "g1" } });
    fireEvent.change(screen.getByLabelText("Closed project 1 disposition"), { target: { value: "archive" } });
    fireEvent.click(screen.getByTestId("closed-project-save"));

    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(String(put[0])).toMatch(/\/closed-projects$/);
    expect(JSON.parse(String(put[1]?.body)).closedProjects).toEqual({ g1: { disposition: "archive" } });
  });
});
