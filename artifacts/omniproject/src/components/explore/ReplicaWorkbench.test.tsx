import { describe, it, expect, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  setFetchInterceptor,
  getListProjectsUrl,
  getGetProjectIssuesUrl,
  getGetCapabilitiesUrl,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { ReplicaWorkbench } from "./ReplicaWorkbench";

// The workbench installs a GLOBAL fetch interceptor in replica mode; make sure a
// test never leaks it into the next one.
afterEach(() => setFetchInterceptor(null));

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
});
