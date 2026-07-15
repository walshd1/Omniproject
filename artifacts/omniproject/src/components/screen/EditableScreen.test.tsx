import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import type { ScreenDef } from "../../lib/screen";

/**
 * EditableScreen: the generic PMO/admin layout editor over ScreenRenderer. A non-editor sees only the
 * arranged screen; a PMO/admin gets Edit layout → reorder (drag), ±span, hide/show → Save, which persists
 * the merged per-screen layout map. These lock the gating and the save payload.
 */

let role = "viewer";
const saveMutate = vi.fn();

vi.mock("../../lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/auth")>();
  return { ...actual, useAuth: () => ({ data: { role } }) };
});

vi.mock("../../lib/screen-layouts", () => ({
  useScreenLayouts: () => ({ data: { other: { order: ["x"] } } }),
  useSaveScreenLayouts: () => ({ mutate: saveMutate, isPending: false }),
}));

const { EditableScreen } = await import("./EditableScreen");

const s: ScreenDef = {
  id: "rep",
  label: "Report",
  panels: [
    { id: "a", kind: "metric", title: "Alpha", span: 6, config: { value: 1 } },
    { id: "b", kind: "metric", title: "Bravo", span: 6, config: { value: 2 } },
  ],
};

beforeEach(() => {
  role = "viewer";
  saveMutate.mockReset();
});

describe("EditableScreen", () => {
  it("hides the editor affordance from non-PMO/admin users", () => {
    renderWithProviders(<EditableScreen screen={s} />);
    expect(screen.queryByTestId("edit-layout")).toBeNull();
    // …but the screen itself still renders.
    expect(screen.getByTestId("screen-renderer")).toBeTruthy();
  });

  it("offers Edit layout to a PMO and enters edit mode", () => {
    role = "pmo";
    renderWithProviders(<EditableScreen screen={s} />);
    fireEvent.click(screen.getByTestId("edit-layout"));
    expect(screen.getByTestId("layout-editor-controls")).toBeTruthy();
    expect(screen.getByTestId("save-layout")).toBeTruthy();
  });

  it("saves a merged layout map with span + hidden edits (preserving other screens)", () => {
    role = "admin";
    renderWithProviders(<EditableScreen screen={s} />);
    fireEvent.click(screen.getByTestId("edit-layout"));
    // widen Alpha to 7, hide Bravo
    fireEvent.click(screen.getByTestId("span-up-a"));
    expect(screen.getByTestId("span-value-a").textContent).toBe("7");
    fireEvent.click(screen.getByTestId("toggle-hidden-b"));
    fireEvent.click(screen.getByTestId("save-layout"));
    expect(saveMutate).toHaveBeenCalledTimes(1);
    const [payload] = saveMutate.mock.calls[0]!;
    // the OTHER screen's layout is preserved, and ours carries the edits
    expect(payload.other).toEqual({ order: ["x"] });
    expect(payload.rep.spans.a).toBe(7);
    expect(payload.rep.hidden).toContain("b");
  });

  it("Cancel discards the draft without saving", () => {
    role = "pmo";
    renderWithProviders(<EditableScreen screen={s} />);
    fireEvent.click(screen.getByTestId("edit-layout"));
    fireEvent.click(screen.getByTestId("span-up-a"));
    fireEvent.click(screen.getByTestId("cancel-layout"));
    expect(screen.queryByTestId("layout-editor-controls")).toBeNull();
    expect(saveMutate).not.toHaveBeenCalled();
  });
});
