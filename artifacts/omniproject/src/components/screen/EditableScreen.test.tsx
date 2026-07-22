import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import type { ScreenDef } from "../../lib/screen";

/**
 * EditableScreen: the generic PMO/admin layout editor over ScreenRenderer. A non-editor sees only the
 * arranged screen; a PMO/admin gets Edit layout → reorder (drag), ±span, hide/show → Save, which FOLDS the
 * layout INTO the screen def (upserted through the importer). These lock the gating and the save payload.
 */

let role = "viewer";
let savedLayouts: Record<string, unknown> = {}; // legacy `screenLayouts` bridge (pre-fold)
const saveOverride = vi.fn().mockResolvedValue(undefined);

vi.mock("../../lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/auth")>();
  return { ...actual, useAuth: () => ({ data: { role } }) };
});

vi.mock("../../lib/screen-layouts", () => ({
  useScreenLayouts: () => ({ data: savedLayouts }),
}));

vi.mock("../../lib/org-screens", () => ({
  useSaveScreenOverride: () => ({ save: saveOverride, saving: false }),
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
  savedLayouts = {};
  saveOverride.mockClear();
});

const wraps = () => screen.getAllByTestId(/^panel-wrap-/).map((el) => el.getAttribute("data-testid"));

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

  it("folds the layout INTO the screen def with span + hidden edits (id pinned, panels kept)", async () => {
    role = "admin";
    renderWithProviders(<EditableScreen screen={s} />);
    fireEvent.click(screen.getByTestId("edit-layout"));
    // widen Alpha to 7, hide Bravo
    fireEvent.click(screen.getByTestId("span-up-a"));
    expect(screen.getByTestId("span-value-a").textContent).toBe("7");
    fireEvent.click(screen.getByTestId("toggle-hidden-b"));
    fireEvent.click(screen.getByTestId("save-layout"));
    await vi.waitFor(() => expect(saveOverride).toHaveBeenCalledTimes(1));
    const [def] = saveOverride.mock.calls[0]!;
    // the saved DEF is this screen (id pinned, panels preserved) carrying the arrangement in `layout`
    expect(def.id).toBe("rep");
    expect(def.panels).toHaveLength(2);
    expect(def.layout.spans.a).toBe(7);
    expect(def.layout.hidden).toContain("b");
  });

  it("applies a methodology fallback layout when the customer has none saved", () => {
    savedLayouts = {}; // no customer layout for this screen
    renderWithProviders(<EditableScreen screen={s} fallbackLayout={{ order: ["b", "a"] }} />);
    expect(wraps()).toEqual(["panel-wrap-b", "panel-wrap-a"]); // fallback order applied
  });

  it("prefers the customer's saved layout over the methodology fallback", () => {
    savedLayouts = { rep: { order: ["a", "b"] } }; // customer saved a→b
    renderWithProviders(<EditableScreen screen={s} fallbackLayout={{ order: ["b", "a"] }} />);
    expect(wraps()).toEqual(["panel-wrap-a", "panel-wrap-b"]); // saved wins over fallback
  });

  it("Cancel discards the draft without saving", () => {
    role = "pmo";
    renderWithProviders(<EditableScreen screen={s} />);
    fireEvent.click(screen.getByTestId("edit-layout"));
    fireEvent.click(screen.getByTestId("span-up-a"));
    fireEvent.click(screen.getByTestId("cancel-layout"));
    expect(screen.queryByTestId("layout-editor-controls")).toBeNull();
    expect(saveOverride).not.toHaveBeenCalled();
  });
});
