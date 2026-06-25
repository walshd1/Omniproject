import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/utils";
import { ShortcutsDialog } from "./ShortcutsDialog";

describe("ShortcutsDialog", () => {
  it("renders nothing visible when closed", () => {
    renderWithProviders(<ShortcutsDialog open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText("Keyboard shortcuts")).not.toBeInTheDocument();
  });

  it("renders the dialog with its title and description when open", () => {
    renderWithProviders(<ShortcutsDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Move around OmniProject without leaving the keyboard.")).toBeInTheDocument();
  });

  it("renders the group headings and shortcut rows", () => {
    renderWithProviders(<ShortcutsDialog open onOpenChange={() => {}} />);
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Cards & lists")).toBeInTheDocument();
    expect(screen.getByText("Open command palette")).toBeInTheDocument();
    expect(screen.getByText("Go to Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Open the focused card / issue")).toBeInTheDocument();
  });

  it("calls onOpenChange when closed via Escape", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<ShortcutsDialog open onOpenChange={onOpenChange} />);
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
