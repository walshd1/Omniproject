import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { ReportPicker } from "./ReportPicker";
import type { ReportInfo } from "../../lib/setup";

const evm: ReportInfo = {
  id: "evm",
  label: "Earned Value",
  docsUrl: "https://docs/evm",
  kind: "chart",
  capabilities: { requiresCapability: "financials", timeSeries: true, exports: ["csv", "pdf"] },
  notes: "EVM note.",
};

function mockReports(list: ReportInfo[]) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(list),
  }) as unknown as typeof fetch;
}

describe("ReportPicker", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders nothing when there are no reports", () => {
    mockReports([]);
    const { container } = renderWithProviders(<ReportPicker />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a tile per report, showing its required capability", async () => {
    mockReports([evm]);
    const { findByRole, getByText } = renderWithProviders(<ReportPicker />);
    expect(await findByRole("option", { name: /earned value/i })).toBeInTheDocument();
    expect(getByText(/needs financials/i)).toBeInTheDocument();
  });

  it("expands details on click, pointing to feature governance for enable/disable", async () => {
    mockReports([evm]);
    const user = userEvent.setup();
    const { findByRole, getByText } = renderWithProviders(<ReportPicker />);
    await user.click(await findByRole("option", { name: /earned value/i }));
    expect(getByText("EVM note.")).toBeInTheDocument();
    expect(getByText(/csv, pdf/i)).toBeInTheDocument();
    expect(getByText(/feature governance/i)).toBeInTheDocument();
  });
});
