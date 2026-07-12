import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { MethodologyComposer } from "./MethodologyComposer";

let role = "pmo";
vi.mock("../../lib/auth", () => ({
  useAuth: () => ({ data: { role } }),
  isPmoOrAdmin: (r?: string) => r === "admin" || r === "pmo",
}));

let saved: string[] | null = null;
const mutate = vi.fn();
vi.mock("../../lib/methodology-composition-api", () => ({
  useMethodologyComposition: () => ({ data: saved }),
  useSaveMethodologyComposition: () => ({ mutate, isPending: false }),
}));

beforeEach(() => { role = "pmo"; saved = null; mutate.mockClear(); });

describe("MethodologyComposer", () => {
  it("is hidden from non-PMO/admin", () => {
    role = "contributor";
    renderWithProviders(<MethodologyComposer />);
    expect(screen.queryByTestId("methodology-composer")).not.toBeInTheDocument();
  });

  it("starts uncurated (all shown) and lists preset buttons", () => {
    renderWithProviders(<MethodologyComposer />);
    expect(screen.getByTestId("composition-summary").textContent).toMatch(/all shown/i);
    // At least one methodology preset button (e.g. Scrum) is present.
    expect(screen.queryAllByTestId(/^preset-/).length).toBeGreaterThan(0);
  });

  it("applying a preset curates down, then Save persists the selection", () => {
    renderWithProviders(<MethodologyComposer />);
    const firstPreset = screen.getAllByTestId(/^preset-/)[0]!;
    fireEvent.click(firstPreset);
    // Now curated: summary switches to "N of M shown".
    expect(screen.getByTestId("composition-summary").textContent).toMatch(/of .* shown/i);
    // Save is enabled (draft differs from saved=null) and persists an array.
    fireEvent.click(screen.getByTestId("composition-save"));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(Array.isArray(mutate.mock.calls[0]![0])).toBe(true);
  });

  it("‘Show everything’ resets to uncurated (null)", () => {
    saved = ["report:evm"]; // start curated
    renderWithProviders(<MethodologyComposer />);
    fireEvent.click(screen.getByTestId("composition-show-all"));
    fireEvent.click(screen.getByTestId("composition-save"));
    expect(mutate).toHaveBeenCalledWith(null);
  });
});
