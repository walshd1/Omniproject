import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, type Project } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { CommandPalette } from "./CommandPalette";
import { useStore } from "../store/useStore";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Platform Rewrite",
    identifier: "PLT",
    source: "jira",
    issueCount: 10,
    completedCount: 2,
    memberCount: 3,
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function seeded(projects: Project[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  return qc;
}

beforeEach(() => {
  useStore.setState({
    isCommandOpen: false,
    currentView: "kanban",
    activeProjectId: null,
    theme: "dark",
    isShortcutsOpen: false,
    isNewIssueOpen: false,
  });
});

describe("CommandPalette", () => {
  it("is not rendered when the store is closed", () => {
    renderWithProviders(<CommandPalette />, { client: seeded([]) });
    expect(screen.queryByLabelText("Command palette")).not.toBeInTheDocument();
  });

  it("renders navigation, action and view groups when open", () => {
    useStore.setState({ isCommandOpen: true });
    renderWithProviders(<CommandPalette />, { client: seeded([]) });
    expect(screen.getByLabelText("Command palette")).toBeInTheDocument();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Go to Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Actions")).toBeInTheDocument();
    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Views")).toBeInTheDocument();
    expect(screen.getByText(/Kanban Board/)).toBeInTheDocument();
  });

  it("opens on Cmd/Ctrl+K", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />, { client: seeded([]) });
    expect(screen.queryByLabelText("Command palette")).not.toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByLabelText("Command palette")).toBeInTheDocument();
    expect(useStore.getState().isCommandOpen).toBe(true);
  });

  it("toggles closed again on a second Cmd/Ctrl+K", async () => {
    const user = userEvent.setup();
    useStore.setState({ isCommandOpen: true });
    renderWithProviders(<CommandPalette />, { client: seeded([]) });
    expect(screen.getByLabelText("Command palette")).toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");
    expect(useStore.getState().isCommandOpen).toBe(false);
  });

  it("shows the Jump-to-project group when projects exist", () => {
    useStore.setState({ isCommandOpen: true });
    renderWithProviders(<CommandPalette />, {
      client: seeded([project({ id: "proj-1", name: "Platform Rewrite", identifier: "PLT" })]),
    });
    expect(screen.getByText("Jump to project")).toBeInTheDocument();
    expect(screen.getByText("PLT")).toBeInTheDocument();
    expect(screen.getByText("Platform Rewrite")).toBeInTheDocument();
  });

  it("omits the Jump-to-project group when there are no projects", () => {
    useStore.setState({ isCommandOpen: true });
    renderWithProviders(<CommandPalette />, { client: seeded([]) });
    expect(screen.queryByText("Jump to project")).not.toBeInTheDocument();
  });

  it("toggling theme via the action closes the palette and flips theme", async () => {
    const user = userEvent.setup();
    useStore.setState({ isCommandOpen: true, theme: "dark" });
    renderWithProviders(<CommandPalette />, { client: seeded([]) });
    await user.click(screen.getByText(/Toggle Theme/));
    expect(useStore.getState().theme).toBe("light");
    expect(useStore.getState().isCommandOpen).toBe(false);
  });

  it("selecting a project sets it active and closes the palette", async () => {
    const user = userEvent.setup();
    useStore.setState({ isCommandOpen: true });
    renderWithProviders(<CommandPalette />, {
      client: seeded([project({ id: "proj-42", name: "Mobile App", identifier: "MOB" })]),
    });
    await user.click(screen.getByText("Mobile App"));
    expect(useStore.getState().activeProjectId).toBe("proj-42");
    expect(useStore.getState().isCommandOpen).toBe(false);
  });

  it("the New Task action is available even without an active project (the dialog picks one)", () => {
    useStore.setState({ isCommandOpen: true, activeProjectId: null });
    renderWithProviders(<CommandPalette />, { client: seeded([]) });
    const item = screen.getByText("New Task").closest("[role='option']");
    expect(item).not.toHaveAttribute("aria-disabled", "true");
  });

  it("selecting a view updates the store and closes the palette", async () => {
    const user = userEvent.setup();
    useStore.setState({ isCommandOpen: true, currentView: "kanban" });
    renderWithProviders(<CommandPalette />, { client: seeded([]) });
    await user.click(screen.getByText(/Gantt Timeline/));
    expect(useStore.getState().currentView).toBe("gantt");
    expect(useStore.getState().isCommandOpen).toBe(false);
  });
});
