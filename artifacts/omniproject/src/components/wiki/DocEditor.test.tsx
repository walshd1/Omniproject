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
});
