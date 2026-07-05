import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { getGetCapabilitiesQueryKey, type Capabilities, type Issue } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { IssueDialog } from "./IssueDialog";
import { Toaster } from "./ui/toaster";

/**
 * Guards the a11y fix: every control in the create/edit dialog must have an
 * accessible name (label association), so getByLabelText resolves each one.
 * A regression that drops an htmlFor/aria-label fails this test.
 */
describe("IssueDialog accessible names", () => {
  const fields = ["Title", "Description", "Status", "Priority", "Assignee", "Labels", "Start Date", "Due Date"];

  for (const field of fields) {
    it(`exposes an accessible name for "${field}"`, () => {
      renderWithProviders(
        <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={null} defaultStatus="backlog" />,
      );
      // getByLabelText throws if no control is associated with this label text.
      expect(screen.getByLabelText(field, { exact: false })).toBeInTheDocument();
    });
  }

  it("renders the create heading when no issue is passed", () => {
    renderWithProviders(
      <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={null} defaultStatus="backlog" />,
    );
    // A dialog must exist and be labelled (Radix Dialog.Title).
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("hides a field the backend can't surface and disables a read-only one", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      fields: {
        dueDate: { surface: false, store: false }, // hidden
        assignee: { surface: true, store: false }, // read-only
      },
    } as unknown as Capabilities);
    renderWithProviders(
      <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={null} defaultStatus="backlog" />,
      { client: qc },
    );
    expect(screen.queryByLabelText("Due Date")).toBeNull(); // not surfaced
    expect(screen.getByLabelText("Assignee")).toBeDisabled(); // surfaced, read-only
    expect(screen.getByLabelText("Title", { exact: false })).toBeEnabled(); // core stays editable
  });

  it("shows per-task financial fields only when the backend surfaces them", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      fields: {
        budget: { surface: true, store: true },
        actualCost: { surface: true, store: false }, // read-only
        billable: { surface: true, store: true },
        costCenter: { surface: false, store: false }, // hidden
        currency: { surface: true, store: true },
      },
    } as unknown as Capabilities);
    renderWithProviders(
      <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={null} defaultStatus="backlog" />,
      { client: qc },
    );
    expect(screen.getByLabelText("Budget")).toBeEnabled();
    expect(screen.getByLabelText("Actual cost")).toBeDisabled(); // surfaced, read-only
    expect(screen.getByLabelText("Billable")).toBeInTheDocument();
    expect(screen.queryByLabelText("Cost centre")).toBeNull(); // not surfaced
  });

  it("hides the financials section entirely when no financial field is surfaced", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      fields: {
        budget: { surface: false, store: false },
        actualCost: { surface: false, store: false },
        billable: { surface: false, store: false },
        costCenter: { surface: false, store: false },
        currency: { surface: false, store: false },
      },
    } as unknown as Capabilities);
    renderWithProviders(
      <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={null} defaultStatus="backlog" />,
      { client: qc },
    );
    expect(screen.queryByText("Financials")).toBeNull();
  });

  it("shows effort/time-tracking fields only when the backend surfaces them", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      fields: {
        estimateHours: { surface: true, store: true },
        loggedHours: { surface: true, store: false }, // read-only
        remainingHours: { surface: false, store: false }, // hidden
        storyPoints: { surface: true, store: true },
      },
    } as unknown as Capabilities);
    renderWithProviders(
      <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={null} defaultStatus="backlog" />,
      { client: qc },
    );
    expect(screen.getByText("Effort")).toBeInTheDocument();
    expect(screen.getByLabelText("Estimate (h)")).toBeEnabled();
    expect(screen.getByLabelText("Logged (h)")).toBeDisabled(); // surfaced, read-only
    expect(screen.queryByLabelText("Remaining (h)")).toBeNull(); // not surfaced
    expect(screen.getByLabelText("Story points")).toBeInTheDocument();
  });

  it("hides the effort section entirely when no effort field is surfaced", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      fields: {
        estimateHours: { surface: false, store: false },
        loggedHours: { surface: false, store: false },
        remainingHours: { surface: false, store: false },
        storyPoints: { surface: false, store: false },
      },
    } as unknown as Capabilities);
    renderWithProviders(
      <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={null} defaultStatus="backlog" />,
      { client: qc },
    );
    expect(screen.queryByText("Effort")).toBeNull();
  });

  it("renders the estimate-vs-logged progress when both are known", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      fields: {
        estimateHours: { surface: true, store: true },
        loggedHours: { surface: true, store: true },
      },
    } as unknown as Capabilities);
    const issue = {
      id: "i1", projectId: "proj-1", title: "Has effort", status: "in_progress", priority: "none",
      labels: [], version: 1, estimateHours: 40, loggedHours: 26,
    } as never;
    renderWithProviders(
      <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={issue} />,
      { client: qc },
    );
    const prog = screen.getByTestId("effort-progress");
    expect(prog).toBeInTheDocument();
    expect(prog).toHaveTextContent("65%"); // 26/40
  });

  it("shows risk & quality fields only when the backend surfaces them", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      fields: {
        healthStatus: { surface: true, store: true },
        blocked: { surface: true, store: true },
        blockedReason: { surface: true, store: false }, // read-only
        impact: { surface: false, store: false }, // hidden
        mitigation: { surface: true, store: true },
      },
    } as unknown as Capabilities);
    renderWithProviders(
      <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={null} defaultStatus="backlog" />,
      { client: qc },
    );
    expect(screen.getByText("Risk & quality")).toBeInTheDocument();
    expect(screen.getByLabelText("Health (RAG)")).toBeEnabled();
    expect(screen.getByLabelText("Blocked")).toBeInTheDocument();
    expect(screen.getByLabelText("Blocked reason")).toBeDisabled(); // read-only
    expect(screen.queryByLabelText("Impact")).toBeNull(); // not surfaced
  });

  it("hides the risk & quality section when no quality field is surfaced", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      fields: {
        healthStatus: { surface: false, store: false },
        riskLevel: { surface: false, store: false },
        impact: { surface: false, store: false },
        urgency: { surface: false, store: false },
        blocked: { surface: false, store: false },
        blockedReason: { surface: false, store: false },
        mitigation: { surface: false, store: false },
        defectCount: { surface: false, store: false },
      },
    } as unknown as Capabilities);
    renderWithProviders(
      <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={null} defaultStatus="backlog" />,
      { client: qc },
    );
    expect(screen.queryByText("Risk & quality")).toBeNull();
  });

  it("renders discovered custom fields read-only when the backend exposes them", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      entities: { customField: { surface: true, store: false } },
      customFields: [
        { key: "customerTier", label: "Customer tier", type: "string", surface: true, store: false },
        { key: "riskScore", label: "Risk score", type: "number", surface: true, store: false },
      ],
    } as unknown as Capabilities);
    const issue = {
      id: "i1", projectId: "proj-1", title: "Has customs", status: "todo", priority: "none",
      labels: [], version: 1, customFields: { customerTier: "Enterprise", riskScore: 72 },
    } as never;
    renderWithProviders(
      <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={issue} />,
      { client: qc },
    );
    const panel = screen.getByTestId("custom-fields");
    expect(panel).toHaveTextContent("Customer tier");
    expect(panel).toHaveTextContent("Enterprise");
    expect(panel).toHaveTextContent("Risk score");
    expect(panel).toHaveTextContent("72");
  });

  it("hides the custom-fields section when the entity isn't surfaced", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      entities: { customField: { surface: false, store: false } },
      customFields: [{ key: "customerTier", label: "Customer tier", type: "string", surface: true, store: false }],
    } as unknown as Capabilities);
    const issue = {
      id: "i1", projectId: "proj-1", title: "Has customs", status: "todo", priority: "none",
      labels: [], version: 1, customFields: { customerTier: "Enterprise" },
    } as never;
    renderWithProviders(
      <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={issue} />,
      { client: qc },
    );
    expect(screen.queryByTestId("custom-fields")).toBeNull();
  });

  it("edits effort and risk & quality fields (exercises the input handlers)", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      fields: {
        estimateHours: { surface: true, store: true },
        loggedHours: { surface: true, store: true },
        healthStatus: { surface: true, store: true },
        riskLevel: { surface: true, store: true },
        impact: { surface: true, store: true },
        urgency: { surface: true, store: true },
        blocked: { surface: true, store: true },
        blockedReason: { surface: true, store: true },
        mitigation: { surface: true, store: true },
        defectCount: { surface: true, store: true },
      },
    } as unknown as Capabilities);
    renderWithProviders(
      <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={null} defaultStatus="backlog" />,
      { client: qc },
    );
    await user.type(screen.getByLabelText("Estimate (h)"), "8");
    await user.type(screen.getByLabelText("Logged (h)"), "4");
    await user.type(screen.getByLabelText("Health (RAG)"), "amber");
    await user.type(screen.getByLabelText("Risk level"), "high");
    await user.type(screen.getByLabelText("Impact"), "high");
    await user.type(screen.getByLabelText("Urgency"), "medium");
    await user.type(screen.getByLabelText("Defect count"), "3");
    await user.click(screen.getByLabelText("Blocked"));
    await user.type(screen.getByLabelText("Blocked reason"), "waiting on infra");
    await user.type(screen.getByLabelText("Mitigation"), "spike the export");
    expect((screen.getByLabelText("Health (RAG)") as HTMLInputElement).value).toBe("amber");
    expect((screen.getByLabelText("Blocked") as HTMLInputElement).checked).toBe(true);
    // The derived effort progress reacts to the typed values (4/8 = 50%).
    expect(screen.getByTestId("effort-progress")).toHaveTextContent("50%");
  });

  it("offers Duplicate only when editing an existing task", () => {
    const issue = { id: "i1", projectId: "proj-1", title: "Original", status: "todo", priority: "none", labels: [], version: 1 } as never;
    const { rerender } = renderWithProviders(
      <IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={issue} />,
    );
    expect(screen.getByRole("button", { name: /Duplicate/i })).toBeInTheDocument();

    rerender(<IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={null} defaultStatus="backlog" />);
    expect(screen.queryByRole("button", { name: /Duplicate/i })).toBeNull();
  });
});

/**
 * Submit/duplicate/delete flows: the create/update/delete mutations, the 409
 * optimistic-concurrency branch, and the delete-then-undo round trip. None of the
 * above tests exercise these — they all render the dialog and inspect its fields,
 * never actually submit — so this is genuinely new coverage, not a duplicate.
 */
describe("IssueDialog mutations", () => {
  const editIssue = {
    id: "i1", projectId: "proj-1", title: "Original title", description: "orig desc",
    status: "todo", priority: "none", labels: ["infra"], version: 3,
    assignee: null, startDate: null, dueDate: null,
  } as unknown as Issue;

  // Seed every background query BrandingProvider/useGetCapabilities fire on mount
  // so none of them issue their own fetch — otherwise it'd land in `calls`
  // alongside the mutation this test actually cares about.
  function makeQC() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getGetCapabilitiesQueryKey(), {} as unknown as Capabilities);
    qc.setQueryData(["branding"], {});
    qc.setQueryData(["labels"], {});
    return qc;
  }

  function mockFetchOnce(response: { ok: boolean; status?: number; body?: unknown }) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return {
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 500),
        statusText: response.ok ? "OK" : "Error",
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve(response.body ?? {}),
        text: () => Promise.resolve(JSON.stringify(response.body ?? {})),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return calls;
  }

  afterEach(() => vi.restoreAllMocks());

  it("shows a title-required error and never calls fetch when submitting an empty title", async () => {
    const calls = mockFetchOnce({ ok: true });
    renderWithProviders(
      <><IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={null} defaultStatus="backlog" /><Toaster /></>,
      { client: makeQC() },
    );
    // fireEvent.submit dispatches the event directly, bypassing the native HTML5
    // `required`-attribute validation a real click on the submit button would trigger
    // first (which would block the submit event before our handler ever ran). The
    // dialog is rendered into a Portal, so the form lives on document.body, not
    // inside the render container.
    fireEvent.submit(document.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("An issue needs a title.");
    expect(calls.length).toBe(0);
  });

  it("creates a new issue, toasts, and closes the dialog on success", async () => {
    const user = userEvent.setup();
    const calls = mockFetchOnce({ ok: true, body: { id: "new-1" } });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <><IssueDialog projectId="proj-1" open onOpenChange={onOpenChange} issue={null} defaultStatus="backlog" /><Toaster /></>,
      { client: makeQC() },
    );
    await user.type(screen.getByLabelText("Title", { exact: false }), "Ship the thing");
    await user.click(screen.getByRole("button", { name: /Create issue/i }));

    expect(await screen.findByText("ISSUE CREATED")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(calls.length).toBe(1);
    expect(calls[0]!.init.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.title).toBe("Ship the thing");
  });

  it("shows a generic error toast and keeps the dialog open when creation fails", async () => {
    const user = userEvent.setup();
    mockFetchOnce({ ok: false, status: 500 });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <><IssueDialog projectId="proj-1" open onOpenChange={onOpenChange} issue={null} defaultStatus="backlog" /><Toaster /></>,
      { client: makeQC() },
    );
    await user.type(screen.getByLabelText("Title", { exact: false }), "Will fail");
    await user.click(screen.getByRole("button", { name: /Create issue/i }));

    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Failed to create issue.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("updates an existing issue, sends expectedVersion, toasts, and closes on success", async () => {
    const user = userEvent.setup();
    const calls = mockFetchOnce({ ok: true, body: { id: "i1" } });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <><IssueDialog projectId="proj-1" open onOpenChange={onOpenChange} issue={editIssue} /><Toaster /></>,
      { client: makeQC() },
    );
    await user.click(screen.getByRole("button", { name: /Save changes/i }));

    expect(await screen.findByText("ISSUE UPDATED")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(calls[0]!.init.method).toBe("PATCH");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.expectedVersion).toBe(3);
  });

  it("shows an edit-conflict toast and still closes the dialog on a 409 response", async () => {
    const user = userEvent.setup();
    mockFetchOnce({ ok: false, status: 409 });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <><IssueDialog projectId="proj-1" open onOpenChange={onOpenChange} issue={editIssue} /><Toaster /></>,
      { client: makeQC() },
    );
    await user.click(screen.getByRole("button", { name: /Save changes/i }));

    expect(await screen.findByText("EDIT CONFLICT")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows a generic error toast and keeps the dialog open on a non-409 update failure", async () => {
    const user = userEvent.setup();
    mockFetchOnce({ ok: false, status: 500 });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <><IssueDialog projectId="proj-1" open onOpenChange={onOpenChange} issue={editIssue} /><Toaster /></>,
      { client: makeQC() },
    );
    await user.click(screen.getByRole("button", { name: /Save changes/i }));

    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Failed to update issue.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("duplicates an issue with a '(copy)'-suffixed title", async () => {
    const user = userEvent.setup();
    const calls = mockFetchOnce({ ok: true, body: { id: "dup-1" } });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <><IssueDialog projectId="proj-1" open onOpenChange={onOpenChange} issue={editIssue} /><Toaster /></>,
      { client: makeQC() },
    );
    await user.click(screen.getByRole("button", { name: /Duplicate/i }));

    expect(await screen.findByText("TASK DUPLICATED")).toBeInTheDocument();
    expect(calls[0]!.init.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.title).toBe("Original title (copy)");
  });

  it("shows a title-required error and never calls fetch when duplicating with an emptied title", async () => {
    const user = userEvent.setup();
    const calls = mockFetchOnce({ ok: true });
    renderWithProviders(
      <><IssueDialog projectId="proj-1" open onOpenChange={() => {}} issue={editIssue} /><Toaster /></>,
      { client: makeQC() },
    );
    await user.clear(screen.getByLabelText("Title", { exact: false }));
    await user.click(screen.getByRole("button", { name: /Duplicate/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("An issue needs a title.");
    expect(calls.length).toBe(0);
  });

  it("deletes an issue via the confirm dialog, then restores it via the toast's Undo action", async () => {
    const calls = mockFetchOnce({ ok: true, body: {} });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <><IssueDialog projectId="proj-1" open onOpenChange={onOpenChange} issue={editIssue} /><Toaster /></>,
      { client: makeQC() },
    );
    // Radix icon/text triggers inside an AlertDialog don't reliably open under userEvent
    // in jsdom (same workaround already used for this pattern elsewhere — see
    // PremiumAdmin.test.tsx's "opens the delete-webhook confirmation dialog").
    fireEvent.click(screen.getByRole("button", { name: "DELETE" }));
    const confirmDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("ISSUE DELETED")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(calls[0]!.init.method).toBe("DELETE");

    // Undo re-creates the issue from the snapshot taken before delete. Its accessible
    // name is just "Undo" — the fuller "Undo delete of {title}" text is a
    // data-radix-toast-announce-alt attribute for screen-reader announcement only.
    // `hidden: true` is needed because the still-open edit dialog's Radix focus
    // scope marks the toast portal (a DOM sibling, not a descendant) aria-hidden.
    fireEvent.click(screen.getByRole("button", { name: "Undo", hidden: true }));
    expect(await screen.findByText("ISSUE RESTORED")).toBeInTheDocument();
    expect(calls[1]!.init.method).toBe("POST");
    const restored = JSON.parse(String(calls[1]!.init.body));
    expect(restored.title).toBe("Original title");
    expect(restored.labels).toEqual(["infra"]);
  });

  it("shows a generic error toast and keeps the dialog open when delete fails", async () => {
    mockFetchOnce({ ok: false, status: 500 });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <><IssueDialog projectId="proj-1" open onOpenChange={onOpenChange} issue={editIssue} /><Toaster /></>,
      { client: makeQC() },
    );
    fireEvent.click(screen.getByRole("button", { name: "DELETE" }));
    const confirmDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Failed to delete issue.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
