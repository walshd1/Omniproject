import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocEditor } from "./DocEditor";
import type { WikiDocInput } from "../../lib/wiki";

/** The block-based doc authoring surface: palette from the primitive store, edit blocks, emit WikiDocInput. */
describe("DocEditor", () => {
  it("renders an add-block palette drawn from the block primitive family", () => {
    render(<DocEditor spaceId="s1" onSave={() => {}} onCancel={() => {}} />);
    // The block primitives (heading, paragraph, checklist, embed, …) appear as add buttons.
    expect(screen.getByTestId("add-block-heading")).toBeInTheDocument();
    expect(screen.getByTestId("add-block-checklist")).toBeInTheDocument();
    expect(screen.getByTestId("add-block-embed")).toBeInTheDocument();
  });

  it("requires a title and emits a WikiDocInput with the authored blocks on save", () => {
    const onSave = vi.fn<(i: WikiDocInput) => void>();
    render(<DocEditor spaceId="s1" onSave={onSave} onCancel={() => {}} />);
    // Save disabled until a title is present.
    expect(screen.getByTestId("doc-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("doc-title"), { target: { value: "Runbook" } });
    // Author the default paragraph block, then add a heading.
    fireEvent.change(screen.getByLabelText("Block 1 text"), { target: { value: "Intro" } });
    fireEvent.click(screen.getByTestId("add-block-heading"));
    fireEvent.change(screen.getByLabelText("Block 2 text"), { target: { value: "Steps" } });

    fireEvent.click(screen.getByTestId("doc-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    const input = onSave.mock.calls[0]![0];
    expect(input.spaceId).toBe("s1");
    expect(input.title).toBe("Runbook");
    expect(input.blocks).toHaveLength(2);
    expect(input.blocks[0]).toMatchObject({ type: "paragraph", text: "Intro" });
    expect(input.blocks[1]).toMatchObject({ type: "heading", text: "Steps", level: 2 });
  });

  it("offers a parent-page picker and emits the chosen parentId (page tree)", () => {
    const onSave = vi.fn<(i: WikiDocInput) => void>();
    const docs = [
      { id: "p1", spaceId: "s1", parentId: null, slug: "p1", title: "Parent one", updatedAt: "" },
      { id: "p2", spaceId: "s2", parentId: null, slug: "p2", title: "Other space", updatedAt: "" },
    ];
    render(<DocEditor spaceId="s1" docs={docs} onSave={onSave} onCancel={() => {}} />);
    // Only same-space docs are offered as parents.
    expect(screen.getByRole("option", { name: "Parent one" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Other space" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("doc-title"), { target: { value: "Child" } });
    fireEvent.change(screen.getByTestId("doc-parent"), { target: { value: "p1" } });
    fireEvent.click(screen.getByTestId("doc-save"));
    expect(onSave.mock.calls[0]![0].parentId).toBe("p1");
  });

  it("excludes the doc itself and its descendants from parent options (no cycles)", () => {
    const doc = { id: "a", spaceId: "s1", parentId: null, slug: "a", title: "A", updatedAt: "", blocks: [] };
    const docs = [
      doc,
      { id: "a1", spaceId: "s1", parentId: "a", slug: "a1", title: "A child", updatedAt: "" },
      { id: "b", spaceId: "s1", parentId: null, slug: "b", title: "B", updatedAt: "" },
    ];
    render(<DocEditor spaceId="s1" doc={doc} docs={docs} onSave={() => {}} onCancel={() => {}} />);
    // A itself and its descendant A-child can't be parents; B can.
    expect(screen.queryByRole("option", { name: "A" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "A child" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "B" })).toBeInTheDocument();
  });

  it("edits an existing doc's blocks and can remove one", () => {
    const onSave = vi.fn<(i: WikiDocInput) => void>();
    const doc = { id: "d1", spaceId: "s1", slug: "d", title: "Doc", updatedAt: "", blocks: [
      { id: "b1", type: "paragraph" as const, text: "one" },
      { id: "b2", type: "paragraph" as const, text: "two" },
    ] };
    render(<DocEditor spaceId="s1" doc={doc} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByTestId("block-0-remove"));
    fireEvent.click(screen.getByTestId("doc-save"));
    const input = onSave.mock.calls[0]![0];
    expect(input.blocks).toHaveLength(1);
    expect(input.blocks[0]).toMatchObject({ text: "two" });
  });

  it("invokes onCancel from the Cancel button", () => {
    const onCancel = vi.fn();
    render(<DocEditor spaceId="s1" onSave={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId("doc-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows a Saving… label and disables save while saving", () => {
    render(<DocEditor spaceId="s1" onSave={() => {}} onCancel={() => {}} saving />);
    const save = screen.getByTestId("doc-save");
    expect(save).toBeDisabled();
    expect(save).toHaveTextContent("Saving…");
  });

  it("adds a callout block and edits its tone (default block defaults to info)", () => {
    const onSave = vi.fn<(i: WikiDocInput) => void>();
    render(<DocEditor spaceId="s1" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("doc-title"), { target: { value: "T" } });
    fireEvent.click(screen.getByTestId("add-block-callout"));
    fireEvent.change(screen.getByLabelText("Block 2 tone"), { target: { value: "warn" } });
    fireEvent.change(screen.getByLabelText("Block 2 text"), { target: { value: "Heads up" } });
    fireEvent.click(screen.getByTestId("doc-save"));
    expect(onSave.mock.calls[0]![0].blocks[1]).toMatchObject({ type: "callout", tone: "warn", text: "Heads up" });
  });

  it("adds a heading block and changes its level", () => {
    const onSave = vi.fn<(i: WikiDocInput) => void>();
    render(<DocEditor spaceId="s1" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("doc-title"), { target: { value: "T" } });
    fireEvent.click(screen.getByTestId("add-block-heading"));
    fireEvent.change(screen.getByLabelText("Block 2 heading level"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Block 2 text"), { target: { value: "Title" } });
    fireEvent.click(screen.getByTestId("doc-save"));
    expect(onSave.mock.calls[0]![0].blocks[1]).toMatchObject({ type: "heading", level: 1, text: "Title" });
  });

  it("adds a checklist and can edit, check, add and remove items", () => {
    const onSave = vi.fn<(i: WikiDocInput) => void>();
    render(<DocEditor spaceId="s1" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("doc-title"), { target: { value: "T" } });
    fireEvent.click(screen.getByTestId("add-block-checklist"));
    // The blank checklist starts with one item.
    fireEvent.change(screen.getByLabelText("Block 2 item 1"), { target: { value: "first" } });
    fireEvent.click(screen.getByLabelText("Item 1 checked"));
    // Add a second item, fill it, then remove it again.
    fireEvent.click(screen.getByText("+ item"));
    fireEvent.change(screen.getByLabelText("Block 2 item 2"), { target: { value: "second" } });
    fireEvent.click(screen.getByLabelText("Remove item 2"));
    fireEvent.click(screen.getByTestId("doc-save"));
    const block = onSave.mock.calls[0]![0].blocks[1] as { type: string; items: Array<{ text: string; checked?: boolean }> };
    expect(block.type).toBe("checklist");
    expect(block.items).toHaveLength(1);
    expect(block.items[0]).toMatchObject({ text: "first", checked: true });
  });

  it("adds a bullet list and edits its item text", () => {
    const onSave = vi.fn<(i: WikiDocInput) => void>();
    render(<DocEditor spaceId="s1" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("doc-title"), { target: { value: "T" } });
    fireEvent.click(screen.getByTestId("add-block-bullet-list"));
    fireEvent.change(screen.getByLabelText("Block 2 item 1"), { target: { value: "point" } });
    fireEvent.click(screen.getByTestId("doc-save"));
    const block = onSave.mock.calls[0]![0].blocks[1] as { type: string; items: Array<{ text: string }> };
    expect(block.type).toBe("bullet-list");
    expect(block.items[0]!.text).toBe("point");
    // Checklist-only checkbox is absent for a bullet list.
    expect(screen.queryByLabelText("Item 1 checked")).toBeNull();
  });

  it("adds an embed block and edits its url and caption", () => {
    const onSave = vi.fn<(i: WikiDocInput) => void>();
    render(<DocEditor spaceId="s1" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("doc-title"), { target: { value: "T" } });
    fireEvent.click(screen.getByTestId("add-block-embed"));
    fireEvent.change(screen.getByLabelText("Block 2 url"), { target: { value: "https://x.test" } });
    fireEvent.change(screen.getByLabelText("Block 2 caption"), { target: { value: "Ref" } });
    fireEvent.click(screen.getByTestId("doc-save"));
    expect(onSave.mock.calls[0]![0].blocks[1]).toMatchObject({ type: "embed", url: "https://x.test", caption: "Ref" });
  });

  it("adds a table block and edits a cell, a row and a column", () => {
    const onSave = vi.fn<(i: WikiDocInput) => void>();
    render(<DocEditor spaceId="s1" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("doc-title"), { target: { value: "T" } });
    fireEvent.click(screen.getByTestId("add-block-table"));
    // A blank table is 2x2.
    fireEvent.change(screen.getByLabelText("Block 2 row 1 col 1"), { target: { value: "A1" } });
    fireEvent.click(screen.getByText("+ row"));
    fireEvent.click(screen.getByText("+ column"));
    fireEvent.click(screen.getByTestId("doc-save"));
    const block = onSave.mock.calls[0]![0].blocks[1] as { type: string; rows: string[][] };
    expect(block.type).toBe("table");
    expect(block.rows).toHaveLength(3); // 2 + added row
    expect(block.rows[0]).toHaveLength(3); // 2 + added column
    expect(block.rows[0]![0]).toBe("A1");
  });

  it("adds a divider block (no fields to edit)", () => {
    const onSave = vi.fn<(i: WikiDocInput) => void>();
    render(<DocEditor spaceId="s1" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("doc-title"), { target: { value: "T" } });
    fireEvent.click(screen.getByTestId("add-block-divider"));
    expect(screen.getByText("A horizontal divider.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("doc-save"));
    expect(onSave.mock.calls[0]![0].blocks[1]).toMatchObject({ type: "divider" });
  });

  it("adds a quote and a code block (text types)", () => {
    const onSave = vi.fn<(i: WikiDocInput) => void>();
    render(<DocEditor spaceId="s1" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("doc-title"), { target: { value: "T" } });
    fireEvent.click(screen.getByTestId("add-block-quote"));
    fireEvent.change(screen.getByLabelText("Block 2 text"), { target: { value: "wisdom" } });
    fireEvent.click(screen.getByTestId("add-block-code"));
    fireEvent.change(screen.getByLabelText("Block 3 text"), { target: { value: "print(1)" } });
    fireEvent.click(screen.getByTestId("doc-save"));
    const blocks = onSave.mock.calls[0]![0].blocks;
    expect(blocks[1]).toMatchObject({ type: "quote", text: "wisdom" });
    expect(blocks[2]).toMatchObject({ type: "code", text: "print(1)" });
  });

  it("moves a block up and down, and ignores a move past the ends", () => {
    const onSave = vi.fn<(i: WikiDocInput) => void>();
    const doc = { id: "d1", spaceId: "s1", slug: "d", title: "Doc", updatedAt: "", blocks: [
      { id: "b1", type: "paragraph" as const, text: "one" },
      { id: "b2", type: "paragraph" as const, text: "two" },
    ] };
    render(<DocEditor spaceId="s1" doc={doc} onSave={onSave} onCancel={() => {}} />);
    // Moving the first block up is a no-op (already at the top).
    fireEvent.click(screen.getByLabelText("Move block 1 up"));
    // Move the second block up so it becomes first.
    fireEvent.click(screen.getByLabelText("Move block 2 up"));
    fireEvent.click(screen.getByTestId("doc-save"));
    let blocks = onSave.mock.calls[0]![0].blocks;
    expect(blocks.map((b) => (b as { text: string }).text)).toEqual(["two", "one"]);
    // Now move the (new) first block back down and confirm the order flips again.
    fireEvent.click(screen.getByLabelText("Move block 1 down"));
    fireEvent.click(screen.getByTestId("doc-save"));
    blocks = onSave.mock.calls.at(-1)![0].blocks;
    expect(blocks.map((b) => (b as { text: string }).text)).toEqual(["one", "two"]);
  });
});
