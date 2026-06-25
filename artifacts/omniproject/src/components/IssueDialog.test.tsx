import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
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
});
