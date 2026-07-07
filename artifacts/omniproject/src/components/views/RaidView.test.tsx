import { describe, it, expect, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, renderHook, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  getGetProjectRaidQueryKey,
  type RaidEntry,
} from "@workspace/api-client-react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { useToast } from "@/hooks/use-toast";
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

  it("renders an error alert with retry when the RAID query fails, and Retry re-triggers the fetch", async () => {
    const qc = makeClient();
    seedAuth(qc, "viewer");
    renderWithProviders(<RaidView projectId={PROJECT} />, { client: qc });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("shows optional description/mitigation/owner/due-date fields on a card when present", () => {
    const qc = makeClient();
    seedAuth(qc, "viewer");
    qc.setQueryData(getGetProjectRaidQueryKey(PROJECT), [
      entry({
        id: "full1",
        title: "Fully detailed risk",
        description: "A description",
        mitigation: "A mitigation plan",
        owner: "alice",
        dueDate: "2026-08-01",
      }),
    ]);
    renderWithProviders(<RaidView projectId={PROJECT} />, { client: qc });
    expect(screen.getByText("A description")).toBeInTheDocument();
    expect(screen.getByText(/A mitigation plan/)).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("due 2026-08-01")).toBeInTheDocument();
  });

  describe("submitting a new entry", () => {
    afterEach(resetFetchMock);

    it("fills out every field, submits, shows a success toast and closes the form", async () => {
      const user = userEvent.setup();
      const qc = makeClient();
      seedAuth(qc, "contributor");
      qc.setQueryData(getGetProjectRaidQueryKey(PROJECT), ENTRIES);
      const calls = mockFetchRouter({
        [`POST /api/projects/${PROJECT}/raid`]: { ok: true, body: entry({ id: "new1", title: "New risk" }) },
        [`GET /api/projects/${PROJECT}/raid`]: { ok: true, body: ENTRIES },
      });
      const { result: toastResult } = renderHook(() => useToast());
      const { container } = renderWithProviders(<RaidView projectId={PROJECT} />, { client: qc });

      await user.click(screen.getByRole("button", { name: /\+ Add entry/i }));
      await user.type(screen.getByPlaceholderText("Title"), "New risk");
      await user.type(screen.getByPlaceholderText("Description"), "Some detail");
      await user.selectOptions(screen.getByDisplayValue("risk"), "issue");
      await user.selectOptions(screen.getByDisplayValue("medium"), "critical");
      await user.type(screen.getByPlaceholderText("Owner"), "bob");
      const dueDateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
      fireEvent.change(dueDateInput, { target: { value: "2026-09-01" } });
      await user.click(screen.getByRole("button", { name: /Add to register/i }));

      await waitFor(() =>
        expect(toastResult.current.toasts.some((t) => t.title === "RAID ENTRY ADDED" && t.description === "New risk")).toBe(true),
      );
      expect(screen.queryByPlaceholderText("Title")).not.toBeInTheDocument();

      const postCall = calls.find((c) => c.url.includes(`/api/projects/${PROJECT}/raid`) && c.init?.method === "POST");
      const body = JSON.parse(String(postCall!.init!.body));
      expect(body).toMatchObject({
        title: "New risk",
        description: "Some detail",
        type: "issue",
        severity: "critical",
        owner: "bob",
        dueDate: "2026-09-01",
      });
    });

    it("shows an error toast and keeps the form open when the create mutation fails", async () => {
      const user = userEvent.setup();
      const qc = makeClient();
      seedAuth(qc, "contributor");
      qc.setQueryData(getGetProjectRaidQueryKey(PROJECT), ENTRIES);
      mockFetchRouter({
        [`POST /api/projects/${PROJECT}/raid`]: { ok: false, status: 500, body: { message: "boom" } },
      });
      const { result: toastResult } = renderHook(() => useToast());
      renderWithProviders(<RaidView projectId={PROJECT} />, { client: qc });

      await user.click(screen.getByRole("button", { name: /\+ Add entry/i }));
      await user.type(screen.getByPlaceholderText("Title"), "Will fail");
      await user.click(screen.getByRole("button", { name: /Add to register/i }));

      await waitFor(() => expect(toastResult.current.toasts.some((t) => t.title === "ERROR")).toBe(true));
      expect(screen.getByPlaceholderText("Title")).toBeInTheDocument();
    });
  });
});
