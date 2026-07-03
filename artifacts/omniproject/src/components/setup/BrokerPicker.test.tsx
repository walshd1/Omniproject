import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { BrokerPicker } from "./BrokerPicker";
import type { BrokerInfo } from "../../lib/setup";

const n8n: BrokerInfo = {
  id: "n8n",
  label: "n8n",
  docsUrl: "https://docs/n8n",
  kind: "low-code",
  hosted: false,
  capabilities: { synchronous: true, selfHostable: true, managedAuth: true, eventsInbound: true, eventsOutbound: true },
  build: "workflow-generator",
};

const make: BrokerInfo = {
  id: "make",
  label: "Make",
  docsUrl: "https://docs/make",
  kind: "low-code",
  hosted: true,
  capabilities: { synchronous: true, selfHostable: false, managedAuth: true, eventsInbound: false, eventsOutbound: false },
  build: "scenario-template",
  notes: "Make note.",
};

function mockBrokers(list: BrokerInfo[]) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(list),
  }) as unknown as typeof fetch;
}

describe("BrokerPicker", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders nothing while the broker catalogue is empty", () => {
    mockBrokers([]);
    const { container } = renderWithProviders(<BrokerPicker />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a tile per broker kind, n8n selected by default", async () => {
    mockBrokers([n8n, make]);
    const { findByRole, getByRole } = renderWithProviders(<BrokerPicker />);
    const n8nTile = await findByRole("option", { name: /n8n/i });
    expect(n8nTile).toHaveAttribute("aria-selected", "true");
    expect(getByRole("option", { name: /make/i })).toHaveAttribute("aria-selected", "false");
  });

  it("selecting a different broker shows its own technical details", async () => {
    mockBrokers([n8n, make]);
    const user = userEvent.setup();
    const { findByRole, getByText } = renderWithProviders(<BrokerPicker />);
    await user.click(await findByRole("option", { name: /make/i }));
    expect(getByText(/technical details for make/i)).toBeInTheDocument();
    expect(getByText("Make note.")).toBeInTheDocument();
  });
});
