import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { NotificationPicker } from "./NotificationPicker";
import type { NotificationChannelInfo } from "../../lib/setup";

const slack: NotificationChannelInfo = {
  id: "slack",
  label: "Slack",
  docsUrl: "https://example.test/slack",
  kind: "chat",
  capabilities: { channels: true, directMessage: true, richFormatting: true, threads: true, inboundReply: false, delivery: "incoming-webhook" },
  notes: "Posts via an incoming webhook URL.",
};

function mockChannels(list: NotificationChannelInfo[]) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(list),
  }) as unknown as typeof fetch;
}

describe("NotificationPicker", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders nothing when there are no notification channels", () => {
    mockChannels([]);
    const { container } = renderWithProviders(<NotificationPicker />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a tile per channel and expands details on click", async () => {
    mockChannels([slack]);
    const user = userEvent.setup();
    const { findByRole, getByText } = renderWithProviders(<NotificationPicker />);
    const tile = await findByRole("option", { name: /slack/i });
    await user.click(tile);
    expect(tile).toHaveAttribute("aria-selected", "true");
    expect(getByText("Posts via an incoming webhook URL.")).toBeInTheDocument();
    expect(getByText("incoming-webhook")).toBeInTheDocument();
  });

  it("toggles the detail panel closed when clicking the same tile again", async () => {
    mockChannels([slack]);
    const user = userEvent.setup();
    const { findByRole, queryByText } = renderWithProviders(<NotificationPicker />);
    const tile = await findByRole("option", { name: /slack/i });
    await user.click(tile);
    await user.click(tile);
    expect(tile).toHaveAttribute("aria-selected", "false");
    expect(queryByText("Posts via an incoming webhook URL.")).not.toBeInTheDocument();
  });
});
