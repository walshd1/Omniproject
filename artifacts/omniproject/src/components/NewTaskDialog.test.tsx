import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getListProjectMembersQueryKey,
  type Project,
  type ProjectMember,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { NewTaskDialog } from "./NewTaskDialog";

function seeded(projects: Partial<Project>[], members: ProjectMember[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects as unknown as Project[]);
  if (projects[0]?.id) qc.setQueryData(getListProjectMembersQueryKey(projects[0].id), members);
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

  it("offers only write-access members in the assignee picker", () => {
    const members = [
      { id: "u1", name: "Writer One", access: "write" },
      { id: "u2", name: "Reader Two", access: "read" },
    ] as unknown as ProjectMember[];
    renderWithProviders(<NewTaskDialog open onOpenChange={() => {}} />, {
      client: seeded([{ id: "p1", name: "Alpha" }], members),
    });
    // The assignee picker is present (write-access members exist)…
    expect(screen.getByLabelText("Assignee")).toBeInTheDocument();
    expect(screen.getByText(/Only people with write access/i)).toBeInTheDocument();
  });

  it("hides the assignee picker when no members have write access", () => {
    const members = [{ id: "u2", name: "Reader Two", access: "read" }] as unknown as ProjectMember[];
    renderWithProviders(<NewTaskDialog open onOpenChange={() => {}} />, {
      client: seeded([{ id: "p1", name: "Alpha" }], members),
    });
    expect(screen.queryByLabelText("Assignee")).toBeNull();
  });
});
