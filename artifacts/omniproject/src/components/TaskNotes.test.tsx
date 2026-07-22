import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskNotes } from "./TaskNotes";

/**
 * TaskNotes — the task's rich (markdown-lite) notes field. Covers the read render (bold + safe/unsafe
 * links), the empty state, and the edit → save / cancel flow that hands the raw markdown back.
 */
describe("TaskNotes", () => {
  it("renders markdown: bold text and a safe link as an anchor", () => {
    render(<TaskNotes value={"**important** see [docs](https://x.dev)"} onSave={() => {}} />);
    expect(screen.getByText("important").tagName).toBe("STRONG");
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://x.dev");
  });

  it("does NOT render a javascript: link as an anchor (renders its text instead)", () => {
    render(<TaskNotes value={"click [danger](javascript:alert(1)) now"} onSave={() => {}} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByTestId("task-notes")).toHaveTextContent("danger");
  });

  it("shows the empty state when there are no notes", () => {
    render(<TaskNotes value="" onSave={() => {}} />);
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  });

  it("edit → save hands the raw markdown back to onSave", () => {
    const onSave = vi.fn();
    render(<TaskNotes value="old" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "# New" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith("# New");
  });

  it("edit → cancel discards the draft and leaves the value unchanged", () => {
    const onSave = vi.fn();
    render(<TaskNotes value="keep" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("keep")).toBeInTheDocument();
  });
});
