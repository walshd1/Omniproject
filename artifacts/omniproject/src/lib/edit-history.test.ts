import { describe, it, expect, beforeEach } from "vitest";
import { useEditHistory, EDIT_HISTORY_CAP, type EditEntry } from "./edit-history";

const entry = (over: Partial<EditEntry> = {}): EditEntry => ({
  projectId: "p1", issueId: "i1", field: "status", from: "todo", to: "done", label: "Status", ...over,
});

beforeEach(() => useEditHistory.setState({ past: [], future: [] }));

describe("edit-history store", () => {
  it("records edits onto the past stack and clears the redo future", () => {
    const s = useEditHistory.getState();
    useEditHistory.setState({ future: [entry({ field: "stale" })] });
    s.record(entry());
    expect(useEditHistory.getState().past).toHaveLength(1);
    expect(useEditHistory.getState().future).toEqual([]); // a fresh edit forks history
  });

  it("popUndo moves the last past edit to future and returns it; popRedo reverses it", () => {
    const s = useEditHistory.getState();
    s.record(entry({ field: "a" }));
    s.record(entry({ field: "b" }));
    const undone = useEditHistory.getState().popUndo();
    expect(undone?.field).toBe("b");
    expect(useEditHistory.getState().past.map((e) => e.field)).toEqual(["a"]);
    expect(useEditHistory.getState().future.map((e) => e.field)).toEqual(["b"]);
    const redone = useEditHistory.getState().popRedo();
    expect(redone?.field).toBe("b");
    expect(useEditHistory.getState().past.map((e) => e.field)).toEqual(["a", "b"]);
    expect(useEditHistory.getState().future).toEqual([]);
  });

  it("returns undefined when there is nothing to undo or redo", () => {
    expect(useEditHistory.getState().popUndo()).toBeUndefined();
    expect(useEditHistory.getState().popRedo()).toBeUndefined();
  });

  it("caps the past stack at EDIT_HISTORY_CAP (oldest dropped)", () => {
    const s = useEditHistory.getState();
    for (let i = 0; i < EDIT_HISTORY_CAP + 5; i++) s.record(entry({ field: `f${i}` }));
    const past = useEditHistory.getState().past;
    expect(past).toHaveLength(EDIT_HISTORY_CAP);
    expect(past[0]!.field).toBe("f5"); // the first five fell off the front
  });

  it("clear empties both stacks", () => {
    const s = useEditHistory.getState();
    s.record(entry());
    useEditHistory.setState({ future: [entry()] });
    s.clear();
    expect(useEditHistory.getState()).toMatchObject({ past: [], future: [] });
  });
});
