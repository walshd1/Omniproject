import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, type Project } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { NewTaskDialog } from "./NewTaskDialog";

function seeded(projects: Partial<Project>[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects as unknown as Project[]);
  return qc;
}

describe("NewTaskDialog", () => {
  it("requires a title; defaults the project to the first one", async () => {
    renderWithProviders(<NewTaskDialog open onOpenChange={() => {}} />, {
      client: seeded([{ id: "p1", name: "Alpha" }]),
    });
    expect(screen.getByRole("heading", { name: /New Task/i })).toBeInTheDocument();
    // project defaulted, but title empty → submit disabled
    expect(screen.getByRole("button", { name: /Create task/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Title"), "Wire the callback");
    expect(screen.getByRole("button", { name: /Create task/i })).toBeEnabled();
  });

  it("blocks task creation when there are no projects (a task must belong to one)", () => {
    renderWithProviders(<NewTaskDialog open onOpenChange={() => {}} />, { client: seeded([]) });
    expect(screen.getByText(/No projects yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create task/i })).toBeNull();
  });
});
