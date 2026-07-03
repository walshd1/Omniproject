import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { OutputPicker } from "./OutputPicker";
import type { OutputInfo } from "../../lib/setup";

const exportOutput: OutputInfo = {
  id: "export",
  label: "Export",
  route: "/api/export",
  kind: "export",
  capabilities: { readOnly: true, streaming: false, auth: "session" },
  notes: "Export note.",
};

function mockOutputs(list: OutputInfo[]) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(list),
  }) as unknown as typeof fetch;
}

describe("OutputPicker", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders nothing when there are no outputs", () => {
    mockOutputs([]);
    const { container } = renderWithProviders(<OutputPicker />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a tile per output and expands details on click", async () => {
    mockOutputs([exportOutput]);
    const user = userEvent.setup();
    const { findByRole, getByText } = renderWithProviders(<OutputPicker />);
    const tile = await findByRole("option", { name: /export/i });
    await user.click(tile);
    expect(tile).toHaveAttribute("aria-selected", "true");
    expect(getByText("Export note.")).toBeInTheDocument();
    expect(getByText("/api/export")).toBeInTheDocument();
  });

  it("toggles the detail panel closed when clicking the same tile again", async () => {
    mockOutputs([exportOutput]);
    const user = userEvent.setup();
    const { findByRole, queryByText } = renderWithProviders(<OutputPicker />);
    const tile = await findByRole("option", { name: /export/i });
    await user.click(tile);
    await user.click(tile);
    expect(tile).toHaveAttribute("aria-selected", "false");
    expect(queryByText("Export note.")).not.toBeInTheDocument();
  });
});
