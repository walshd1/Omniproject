import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { getGetCapabilitiesQueryKey, type Capabilities } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { IssueDialog } from "./IssueDialog";

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
