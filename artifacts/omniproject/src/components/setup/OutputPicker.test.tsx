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

  it("lists known + unknown transports and falls back for an unknown kind, with no notes", async () => {
    const feed: OutputInfo = {
      id: "agent-api",
      label: "Agent surface",
      route: "/api/mcp",
      kind: "custom-kind", // not in OUTPUT_LABELS → falls back to the raw kind
      capabilities: { readOnly: false, streaming: true, auth: "token" },
      transports: ["mcp", "carrier-pigeon"], // one known, one unknown → falls back to the raw id
      // no notes → the notes paragraph is not rendered
    };
    mockOutputs([feed]);
    const user = userEvent.setup();
    const { findByRole, getByText, queryByText } = renderWithProviders(<OutputPicker />);
    const tile = await findByRole("option", { name: /agent surface/i });
    // Unknown kind renders verbatim.
    expect(getByText("custom-kind")).toBeInTheDocument();
    await user.click(tile);
    // Known transport label + unknown transport id, joined.
    expect(getByText(/MCP server · carrier-pigeon/)).toBeInTheDocument();
    expect(getByText("/api/mcp")).toBeInTheDocument();
    // No notes were supplied, so no notes paragraph.
    expect(queryByText(/note/i)).not.toBeInTheDocument();
  });
});
