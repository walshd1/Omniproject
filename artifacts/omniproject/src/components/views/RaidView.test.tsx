import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  getGetProjectRaidQueryKey,
  type RaidEntry,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { RaidView } from "./RaidView";

const PROJECT = "proj-1";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
}

function seedAuth(qc: QueryClient, role: "viewer" | "contributor") {
  qc.setQueryData(["auth", "me"], {
    authenticated: true,
    mode: "demo",
    user: null,
    role,
  });
}

function entry(p: Partial<RaidEntry>): RaidEntry {
  return {
    id: "e1",
    projectId: PROJECT,
    type: "risk",
    title: "An entry",
    severity: "medium",
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...p,
  } as RaidEntry;
}

const ENTRIES: RaidEntry[] = [
  entry({ id: "r1", type: "risk", title: "Vendor may slip", severity: "high", provenance: "sourced" }),
  entry({ id: "a1", type: "assumption", title: "Budget approved", severity: "low" }),
  entry({ id: "i1", type: "issue", title: "Server down", severity: "critical", status: "mitigating" }),
  entry({ id: "d1", type: "dependency", title: "Awaiting API", severity: "medium" }),
];

describe("RaidView", () => {
  it("renders the four RAID columns with their entries", () => {
    const qc = makeClient();
    seedAuth(qc, "viewer");
    qc.setQueryData(getGetProjectRaidQueryKey(PROJECT), ENTRIES);
    renderWithProviders(<RaidView projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("RAID Register")).toBeInTheDocument();
    expect(screen.getByText("Risks")).toBeInTheDocument();
    expect(screen.getByText("Assumptions")).toBeInTheDocument();
    expect(screen.getByText("Issues")).toBeInTheDocument();
    expect(screen.getByText("Dependencies")).toBeInTheDocument();
    expect(screen.getByText("Vendor may slip")).toBeInTheDocument();
    expect(screen.getByText("Server down")).toBeInTheDocument();
  });

  it("shows the provenance badge derived from the first entry", () => {
    const qc = makeClient();
    seedAuth(qc, "viewer");
    qc.setQueryData(getGetProjectRaidQueryKey(PROJECT), ENTRIES);
    renderWithProviders(<RaidView projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("LIVE · BACKEND")).toBeInTheDocument();
  });

  it("shows 'None logged' for empty categories", () => {
    const qc = makeClient();
    seedAuth(qc, "viewer");
    qc.setQueryData(getGetProjectRaidQueryKey(PROJECT), []);
    renderWithProviders(<RaidView projectId={PROJECT} />, { client: qc });

    expect(screen.getAllByText("None logged")).toHaveLength(4);
  });

  it("hides the add control for viewers", () => {
    const qc = makeClient();
    seedAuth(qc, "viewer");
    qc.setQueryData(getGetProjectRaidQueryKey(PROJECT), ENTRIES);
    renderWithProviders(<RaidView projectId={PROJECT} />, { client: qc });

    expect(screen.queryByRole("button", { name: /Add entry/i })).not.toBeInTheDocument();
  });

  it("lets contributors toggle the add-entry form", async () => {
    const user = userEvent.setup();
    const qc = makeClient();
    seedAuth(qc, "contributor");
    qc.setQueryData(getGetProjectRaidQueryKey(PROJECT), ENTRIES);
    renderWithProviders(<RaidView projectId={PROJECT} />, { client: qc });

    const addBtn = screen.getByRole("button", { name: /\+ Add entry/i });
    await user.click(addBtn);
    expect(screen.getByPlaceholderText("Title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add to register/i })).toBeInTheDocument();
    // Toggle closed again.
    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.queryByPlaceholderText("Title")).not.toBeInTheDocument();
  });

  it("validates an empty title without submitting", async () => {
    const user = userEvent.setup();
    const qc = makeClient();
    seedAuth(qc, "contributor");
    qc.setQueryData(getGetProjectRaidQueryKey(PROJECT), ENTRIES);
    renderWithProviders(<RaidView projectId={PROJECT} />, { client: qc });

    await user.click(screen.getByRole("button", { name: /\+ Add entry/i }));
    const submit = screen.getByRole("button", { name: /Add to register/i });
    await user.click(submit);
    // Empty title is rejected (early return): the form stays open and the
    // submit button is not stuck in its pending "SAVING…" state.
    expect(screen.getByPlaceholderText("Title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add to register/i })).toBeInTheDocument();
  });

  it("renders an error alert with retry when the RAID query fails", async () => {
    const qc = makeClient();
    seedAuth(qc, "viewer");
    renderWithProviders(<RaidView projectId={PROJECT} />, { client: qc });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
