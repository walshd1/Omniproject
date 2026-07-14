import { describe, it, expect, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  setFetchInterceptor,
  getListProjectsUrl,
  getGetProjectIssuesUrl,
  getGetCapabilitiesUrl,
} from "@workspace/api-client-react";
import { renderWithProviders, mockFetchRouter, resetFetchMock, mockBlobDownload } from "../../test/utils";
import { ReplicaWorkbench } from "./ReplicaWorkbench";

// The workbench installs a GLOBAL fetch interceptor in replica mode; make sure a
// test never leaks it into the next one.
afterEach(() => {
  setFetchInterceptor(null);
  resetFetchMock();
});

function project(id = "p1", name = "Alpha") {
  return { id, name, identifier: "AL", source: "jira", issueCount: 0, completedCount: 0, memberCount: 0, updatedAt: "" };
}

function replicaFile(): File {
  const replica = {
    schema: 1,
    label: "Test snapshot",
    capturedAt: new Date(0).toISOString(),
    responses: {
      [getListProjectsUrl()]: [
        { id: "p1", name: "Alpha", identifier: "AL", source: "jira", issueCount: 1, completedCount: 0, memberCount: 1, updatedAt: "" },
      ],
      [getGetProjectIssuesUrl("p1")]: [
        { id: "i1", projectId: "p1", title: "Recorded task", status: "todo", priority: "medium", assignee: null, labels: [], startDate: null, dueDate: null, source: "jira", version: 1, createdAt: "", updatedAt: "" },
      ],
      [getGetCapabilitiesUrl()]: { mode: "demo", issues: true, scheduling: true },
    },
  };
  return new File([JSON.stringify(replica)], "replica.json", { type: "application/json" });
}

describe("ReplicaWorkbench", () => {
  it("offers capture and import before a snapshot is loaded", () => {
    renderWithProviders(<ReplicaWorkbench />);
    expect(screen.getByTestId("replica-workbench")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Capture live snapshot/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Import replica file")).toBeInTheDocument();
    expect(screen.queryByTestId("replica-view")).toBeNull();
  });

  it("enters replica mode and mounts a live view from an imported snapshot", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReplicaWorkbench />);
    await user.upload(screen.getByLabelText("Import replica file"), replicaFile());

    // Switched into replica mode: the view + controls appear.
    expect(await screen.findByRole("button", { name: /Exit replica/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Replica project")).toBeInTheDocument();
    // A live view is mounted against the snapshot (its data-serving via the
    // interceptor is covered by explore-replica's resolveReplica unit tests).
    expect(screen.getByTestId("replica-view")).toBeInTheDocument();
  });

  it("rejects an invalid replica file", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReplicaWorkbench />);
    await user.upload(
      screen.getByLabelText("Import replica file"),
      new File(["not json"], "bad.json", { type: "application/json" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't a valid replica/i);
  });

  it("captures a live snapshot and enters replica mode", async () => {
    const user = userEvent.setup();
    // captureReplica reads live endpoints; projects is the required read, the rest are best-effort.
    mockFetchRouter({ [getListProjectsUrl()]: { ok: true, body: [project()] } });
    renderWithProviders(<ReplicaWorkbench />);
    await user.click(screen.getByRole("button", { name: /Capture live snapshot/i }));
    expect(await screen.findByRole("button", { name: /Exit replica/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Replica project")).toBeInTheDocument();
  });

  it("surfaces an error when the live capture fails", async () => {
    const user = userEvent.setup();
    // The required projects read fails → captureReplica rejects → the catch sets the error copy.
    mockFetchRouter({ [getListProjectsUrl()]: { ok: false, status: 500 } });
    renderWithProviders(<ReplicaWorkbench />);
    await user.click(screen.getByRole("button", { name: /Capture live snapshot/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't capture a live snapshot/i);
    // Stayed on the pre-capture screen.
    expect(screen.queryByRole("button", { name: /Exit replica/i })).toBeNull();
  });

  it("exits replica mode back to the capture/import screen", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReplicaWorkbench />);
    await user.upload(screen.getByLabelText("Import replica file"), replicaFile());
    await user.click(await screen.findByRole("button", { name: /Exit replica/i }));
    // Back to the landing controls.
    expect(await screen.findByRole("button", { name: /Capture live snapshot/i })).toBeInTheDocument();
    expect(screen.queryByTestId("replica-view")).toBeNull();
  });

  it("exports the loaded replica as a downloadable file", async () => {
    const user = userEvent.setup();
    const blob = mockBlobDownload();
    try {
      renderWithProviders(<ReplicaWorkbench />);
      await user.upload(screen.getByLabelText("Import replica file"), replicaFile());
      await user.click(await screen.findByRole("button", { name: /Export/i }));
      expect(blob.click).toHaveBeenCalled();
    } finally {
      blob.restore();
    }
  });

  it("shows an empty-state (and no project picker) when the snapshot has no projects", async () => {
    const user = userEvent.setup();
    const empty = new File(
      [JSON.stringify({ schema: 1, label: "Empty", capturedAt: new Date(0).toISOString(), responses: { [getListProjectsUrl()]: [] } })],
      "empty.json",
      { type: "application/json" },
    );
    renderWithProviders(<ReplicaWorkbench />);
    await user.upload(screen.getByLabelText("Import replica file"), empty);
    await waitFor(() => expect(screen.getByTestId("replica-view")).toHaveTextContent(/no projects to show/i));
    // With zero projects the project picker is suppressed (only the view picker remains).
    expect(screen.queryByLabelText("Replica project")).toBeNull();
    expect(screen.getByLabelText("Replica view")).toBeInTheDocument();
  });
});
