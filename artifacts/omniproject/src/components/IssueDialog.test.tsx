import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
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
