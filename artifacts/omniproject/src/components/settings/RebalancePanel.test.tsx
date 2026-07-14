import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { RebalancePanel } from "./RebalancePanel";

/**
 * Agentic rebalancing panel: proposals are AI·GENERATED and NOTHING auto-runs — each write
 * proposal is rendered as the confirm-before-execute ActionPlanCard. Empty/403 degrade cleanly.
 */
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
const jsonRes = (body: unknown, ok = true, status = 200) => ({ ok, status, json: () => Promise.resolve(body) });

describe("RebalancePanel", () => {
  it("renders proposals badged AI·GENERATED, each as a confirm-before-execute card (no auto-run)", async () => {
    fetchMock.mockResolvedValue(jsonRes({
      considered: 2,
      projects: 4,
      proposals: [
        { action: "update_issue", tool: "omniproject_update_issue", args: { issueId: "I1", priority: "high" }, write: true, reason: "Apollo is red and overdue." },
      ],
    }));
    renderWithProviders(<RebalancePanel />);
    fireEvent.click(screen.getByTestId("rebalance-suggest"));

    await waitFor(() => expect(screen.getByTestId("rebalance-proposal-0")).toBeInTheDocument());
    expect(screen.getByText("AI · GENERATED")).toBeInTheDocument();
    expect(screen.getByTestId("rebalance-proposal-0")).toHaveTextContent("Apollo is red and overdue.");
    // The write action is shown as a confirm-before-execute card — never an auto-run.
    expect(screen.getByTestId("rebalance-0-plan-action")).toBeInTheDocument();
    expect(screen.getByTestId("rebalance-0-run")).toBeInTheDocument();
    // Nothing was executed: no call reached the MCP write path — a proposal only runs on confirm.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/mcp"))).toBe(false);
  });

  it("shows a clean empty state when the portfolio looks balanced", async () => {
    fetchMock.mockResolvedValue(jsonRes({ considered: 0, projects: 4, proposals: [] }));
    renderWithProviders(<RebalancePanel />);
    fireEvent.click(screen.getByTestId("rebalance-suggest"));
    await waitFor(() => expect(screen.getByTestId("rebalance-empty")).toBeInTheDocument());
  });

  it("shows a plain error when the capability is off → 403", async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: "AI rebalancing is unavailable here" }, false, 403));
    renderWithProviders(<RebalancePanel />);
    fireEvent.click(screen.getByTestId("rebalance-suggest"));
    await waitFor(() => expect(screen.getByTestId("rebalance-error")).toBeInTheDocument());
  });
});
