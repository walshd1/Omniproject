import { describe, it, expect, beforeEach } from "vitest";
import { useSidePanel } from "./side-panel";

describe("useSidePanel store", () => {
  beforeEach(() => useSidePanel.setState({ open: false, projectId: null, issueId: null }));

  it("starts closed with no target", () => {
    const s = useSidePanel.getState();
    expect(s.open).toBe(false);
    expect(s.projectId).toBeNull();
    expect(s.issueId).toBeNull();
  });

  it("openIssue sets the target and opens", () => {
    useSidePanel.getState().openIssue("p1", "i9");
    const s = useSidePanel.getState();
    expect(s).toMatchObject({ open: true, projectId: "p1", issueId: "i9" });
  });

  it("close hides the panel but keeps the last target for the exit transition", () => {
    useSidePanel.getState().openIssue("p1", "i9");
    useSidePanel.getState().close();
    const s = useSidePanel.getState();
    expect(s.open).toBe(false);
    expect(s.projectId).toBe("p1");
    expect(s.issueId).toBe("i9");
  });
});
