import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, getGetProjectIssuesQueryKey, type Project, type Issue } from "@workspace/api-client-react";
import { renderWithProviders, mockBlobDownload, issue } from "../../test/utils";
import { Toaster } from "../ui/toaster";
import { DependencyLinks } from "./DependencyLinks";
import { createEdge, saveEdges, type ItemRef } from "../../lib/dependencies";

const projects = [
  { id: "p1", name: "Alpha", identifier: "AL", source: "jira", issueCount: 2, completedCount: 0, memberCount: 1, updatedAt: "" },
  { id: "p2", name: "Beta", identifier: "BE", source: "servicenow", issueCount: 2, completedCount: 0, memberCount: 1, updatedAt: "" },
] as unknown as Project[];

function seeded(opts: { p1Issues?: Issue[]; p2Issues?: Issue[] } = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, enabled: false } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), opts.p1Issues ?? [issue({ id: "a-1", projectId: "p1", title: "Alpha task", source: "jira" })]);
  qc.setQueryData(getGetProjectIssuesQueryKey("p2"), opts.p2Issues ?? [issue({ id: "b-9", projectId: "p2", title: "Beta task", source: "servicenow" })]);
  return qc;
}

/** Picks a project + item in one of the two ItemPicker column (e.g. "Source"/"Target"). */
async function pick(user: ReturnType<typeof userEvent.setup>, label: string, projectName: string, itemMatch: RegExp) {
  await user.click(screen.getByRole("combobox", { name: `${label} project` }));
  await user.click(await screen.findByRole("option", { name: projectName }));
  await user.click(screen.getByRole("combobox", { name: `${label} item` }));
  await user.click(await screen.findByRole("option", { name: itemMatch }));
}

beforeEach(() => window.sessionStorage.clear());

describe("DependencyLinks", () => {
  it("shows the empty state and the captured-provenance badge", () => {
    renderWithProviders(<DependencyLinks />, { client: seeded() });
    expect(screen.getByTestId("dep-empty")).toBeInTheDocument();
    expect(screen.getByText(/captured/i)).toBeInTheDocument();
  });

  it("renders a previously-linked edge from the session (refs only, no content)", async () => {
    const from: ItemRef = { system: "jira", projectRef: "p1", itemRef: "a-1" };
    const to: ItemRef = { system: "servicenow", projectRef: "p2", itemRef: "b-9" };
    const edge = await createEdge(from, to, "blocks", { status: "open", title: "secret" }, { status: "new", title: "hidden" });
    saveEdges([edge]);

    renderWithProviders(<DependencyLinks />, { client: seeded() });
    expect(screen.getByLabelText("Dependency edges")).toBeInTheDocument();
    expect(screen.getByText("jira:a-1")).toBeInTheDocument();
    expect(screen.getByText("servicenow:b-9")).toBeInTheDocument();
    // Anti-creep: the stored/rendered edge carries no item content.
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument();
  });

  it("requires both endpoints before linking, even with nothing picked at all", async () => {
    renderWithProviders(<><DependencyLinks /><Toaster /></>, { client: seeded() });
    await userEvent.click(screen.getByTestId("dep-link"));
    expect(await screen.findByText("PICK BOTH ENDPOINTS")).toBeInTheDocument();
    expect(screen.getByTestId("dep-empty")).toBeInTheDocument();
  });

  it("doesn't crash while the project list hasn't loaded yet", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithProviders(<DependencyLinks />, { client: qc });
    expect(screen.getByTestId("dep-empty")).toBeInTheDocument();
  });

  it("selecting then clearing the file input does nothing (no file to import)", async () => {
    renderWithProviders(<><DependencyLinks /><Toaster /></>, { client: seeded() });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(screen.queryByText("IMPORT FAILED")).toBeNull();
    expect(screen.queryByText("DEPENDENCIES IMPORTED")).toBeNull();
  });

  it("requires both endpoints before linking", async () => {
    const user = userEvent.setup();
    renderWithProviders(<><DependencyLinks /><Toaster /></>, { client: seeded() });
    await pick(user, "Source", "Alpha", /a-1/);
    await user.click(screen.getByTestId("dep-link"));
    expect(await screen.findByText("PICK BOTH ENDPOINTS")).toBeInTheDocument();
    expect(screen.getByTestId("dep-empty")).toBeInTheDocument();
  });

  it("rejects linking an item to itself", async () => {
    const user = userEvent.setup();
    renderWithProviders(<><DependencyLinks /><Toaster /></>, { client: seeded() });
    await pick(user, "Source", "Alpha", /a-1/);
    await pick(user, "Target", "Alpha", /a-1/);
    await user.click(screen.getByTestId("dep-link"));
    expect(await screen.findByText("INVALID LINK")).toBeInTheDocument();
    expect(screen.getByTestId("dep-empty")).toBeInTheDocument();
  });

  it("links two items, storing only fingerprints", async () => {
    const user = userEvent.setup();
    renderWithProviders(<><DependencyLinks /><Toaster /></>, { client: seeded() });
    await pick(user, "Source", "Alpha", /a-1/);
    await pick(user, "Target", "Beta", /b-9/);
    await user.click(screen.getByTestId("dep-link"));
    expect(await screen.findByText("DEPENDENCY LINKED")).toBeInTheDocument();
    expect(screen.getByText("jira:a-1")).toBeInTheDocument();
    expect(screen.getByText("servicenow:b-9")).toBeInTheDocument();
    expect(screen.queryByTestId("dep-empty")).not.toBeInTheDocument();
  });

  it("links with a non-default dependency type", async () => {
    const user = userEvent.setup();
    renderWithProviders(<><DependencyLinks /><Toaster /></>, { client: seeded() });
    await user.click(screen.getByTestId("dep-type"));
    await user.click(await screen.findByRole("option", { name: "depends on" }));
    await pick(user, "Source", "Alpha", /a-1/);
    await pick(user, "Target", "Beta", /b-9/);
    await user.click(screen.getByTestId("dep-link"));
    expect(await screen.findByText("DEPENDENCY LINKED")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Dependency edges")).getByText(/depends on/)).toBeInTheDocument();
  });

  it("clicking Import opens the hidden file picker", async () => {
    renderWithProviders(<DependencyLinks />, { client: seeded() });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");
    await userEvent.click(screen.getByRole("button", { name: /import/i }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("imports edges from a file", async () => {
    const from: ItemRef = { system: "jira", projectRef: "p1", itemRef: "a-1" };
    const to: ItemRef = { system: "servicenow", projectRef: "p2", itemRef: "b-9" };
    const edge = await createEdge(from, to, "blocks", { status: "open" }, { status: "new" });
    const bundle = { schema: 1, exportedAt: "2024-01-01T00:00:00.000Z", edges: [edge] };
    renderWithProviders(<><DependencyLinks /><Toaster /></>, { client: seeded() });

    const file = new File([JSON.stringify(bundle)], "deps.json", { type: "application/json" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);

    expect(await screen.findByText("DEPENDENCIES IMPORTED")).toBeInTheDocument();
    expect(screen.getByText("jira:a-1")).toBeInTheDocument();
  });

  it("shows an error toast when the imported file has no valid edges", async () => {
    renderWithProviders(<><DependencyLinks /><Toaster /></>, { client: seeded() });
    const file = new File(["not json"], "deps.json", { type: "application/json" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);
    expect(await screen.findByText("IMPORT FAILED")).toBeInTheDocument();
    expect(screen.getByTestId("dep-empty")).toBeInTheDocument();
  });

  it("exports a single edge and disables/enables Export all with the edge list", async () => {
    const from: ItemRef = { system: "jira", projectRef: "p1", itemRef: "a-1" };
    const to: ItemRef = { system: "servicenow", projectRef: "p2", itemRef: "b-9" };
    const edge = await createEdge(from, to, "blocks", { status: "open" }, { status: "new" });
    saveEdges([edge]);
    const { click, restore } = mockBlobDownload();
    try {
      renderWithProviders(<DependencyLinks />, { client: seeded() });
      expect(screen.getByRole("button", { name: /export all/i })).toBeEnabled();

      await userEvent.click(screen.getByRole("button", { name: "Export this edge" }));
      expect(click).toHaveBeenCalledTimes(1);

      await userEvent.click(screen.getByRole("button", { name: /export all/i }));
      expect(click).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });

  it("disables Export all when there are no edges", () => {
    renderWithProviders(<DependencyLinks />, { client: seeded() });
    expect(screen.getByRole("button", { name: /export all/i })).toBeDisabled();
  });

  it("deletes an edge", async () => {
    const from: ItemRef = { system: "jira", projectRef: "p1", itemRef: "a-1" };
    const to: ItemRef = { system: "servicenow", projectRef: "p2", itemRef: "b-9" };
    const edge = await createEdge(from, to, "blocks", { status: "open" }, { status: "new" });
    saveEdges([edge]);
    renderWithProviders(<DependencyLinks />, { client: seeded() });
    expect(screen.getByText("jira:a-1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete this edge" }));
    expect(screen.queryByText("jira:a-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("dep-empty")).toBeInTheDocument();
  });

  it("flags a drifted edge and shows the drift-count badge once both endpoints are browsed to", async () => {
    const from: ItemRef = { system: "jira", projectRef: "p1", itemRef: "a-1" };
    const to: ItemRef = { system: "servicenow", projectRef: "p2", itemRef: "b-9" };
    // Asserted at link time with this title; the live issue below now has a DIFFERENT one.
    const edge = await createEdge(from, to, "blocks", { status: "open", title: "Original title" }, { status: "new", title: "Original title" });
    saveEdges([edge]);
    const user = userEvent.setup();
    const client = seeded({
      p1Issues: [issue({ id: "a-1", projectId: "p1", title: "Changed title", source: "jira" })],
      p2Issues: [issue({ id: "b-9", projectId: "p2", title: "Beta task", source: "servicenow" })],
    });
    renderWithProviders(<DependencyLinks />, { client });

    // Browsing to each endpoint's project loads its issues, which the drift effect re-hashes.
    await user.click(screen.getByRole("combobox", { name: "Source project" }));
    await user.click(await screen.findByRole("option", { name: "Alpha" }));
    await user.click(screen.getByRole("combobox", { name: "Target project" }));
    await user.click(await screen.findByRole("option", { name: "Beta" }));

    expect(await screen.findByText("drifted")).toBeInTheDocument();
    expect(screen.getByTestId("drift-count")).toHaveTextContent("1 drifted");
    // Anti-creep: titles feed the drift hash but are never themselves rendered.
    expect(screen.queryByText(/Original title/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Changed title/)).not.toBeInTheDocument();
  });

  it("shows a fresh edge as unchanged once both endpoints are browsed to", async () => {
    const from: ItemRef = { system: "jira", projectRef: "p1", itemRef: "a-1" };
    const to: ItemRef = { system: "servicenow", projectRef: "p2", itemRef: "b-9" };
    const edge = await createEdge(from, to, "blocks", { status: "open", title: "Same title" }, { status: "new", title: "Same title" });
    saveEdges([edge]);
    const user = userEvent.setup();
    const client = seeded({
      p1Issues: [issue({ id: "a-1", projectId: "p1", title: "Same title", status: "open", source: "jira" })],
      p2Issues: [issue({ id: "b-9", projectId: "p2", title: "Same title", status: "new", source: "servicenow" })],
    });
    renderWithProviders(<DependencyLinks />, { client });

    await user.click(screen.getByRole("combobox", { name: "Source project" }));
    await user.click(await screen.findByRole("option", { name: "Alpha" }));
    await user.click(screen.getByRole("combobox", { name: "Target project" }));
    await user.click(await screen.findByRole("option", { name: "Beta" }));

    expect(await screen.findByText("fresh")).toBeInTheDocument();
    expect(screen.queryByTestId("drift-count")).not.toBeInTheDocument();
    // Anti-creep: titles feed the drift hash but are never themselves rendered.
    expect(screen.queryByText(/Same title/)).not.toBeInTheDocument();
  });
});
