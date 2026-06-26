import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { getListProgrammesQueryKey, type Programme } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { NewProjectDialog } from "./NewProjectDialog";

function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProgrammesQueryKey(), [
    { id: "prog-1", name: "Platform" },
  ] as unknown as Programme[]);
  return qc;
}

describe("NewProjectDialog", () => {
  it("renders the create form with name required", async () => {
    renderWithProviders(<NewProjectDialog open onOpenChange={() => {}} />, { client: seeded() });
    expect(screen.getByRole("heading", { name: /New Project/i })).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: /Create project/i });
    // empty name → submit disabled
    expect(submit).toBeDisabled();
  });

  it("enables submit once a name is entered and surfaces existing programmes", async () => {
    renderWithProviders(<NewProjectDialog open onOpenChange={() => {}} />, { client: seeded() });
    await userEvent.type(screen.getByLabelText("Name"), "Apollo");
    expect(screen.getByRole("button", { name: /Create project/i })).toBeEnabled();
    // the programme datalist offers the existing programme
    expect(screen.getByText("Platform")).toBeInTheDocument();
  });

  it("flags a whitespace-only name as invalid", async () => {
    renderWithProviders(<NewProjectDialog open onOpenChange={() => {}} />, { client: seeded() });
    await userEvent.type(screen.getByLabelText("Name"), "   ");
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
    expect(screen.getByRole("button", { name: /Create project/i })).toBeDisabled();
  });
});
