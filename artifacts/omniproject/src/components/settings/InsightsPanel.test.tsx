import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { InsightsPanel } from "./InsightsPanel";

/**
 * Portfolio AI insights panel: a read-only narrative that is ALWAYS badged AI·GENERATED, and
 * degrades gracefully when the capability is off (the endpoint 403s).
 */
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
const jsonRes = (body: unknown, ok = true, status = 200) => ({ ok, status, json: () => Promise.resolve(body) });

describe("InsightsPanel", () => {
  it("renders both insight actions and no narrative until run", () => {
    fetchMock.mockResolvedValue(jsonRes({}));
    renderWithProviders(<InsightsPanel />);
    expect(screen.getByTestId("insight-status-narrative")).toBeInTheDocument();
    expect(screen.getByTestId("insight-risk-outlook")).toBeInTheDocument();
    expect(screen.queryByTestId("insight-narrative")).toBeNull();
  });

  it("runs an insight and renders the narrative WITH the AI·GENERATED provenance badge", async () => {
    fetchMock.mockResolvedValue(jsonRes({ kind: "status-narrative", narrative: "Portfolio is broadly amber; Apollo needs attention.", projects: 4 }));
    renderWithProviders(<InsightsPanel />);
    fireEvent.click(screen.getByTestId("insight-status-narrative"));
    await waitFor(() => expect(screen.getByTestId("insight-narrative")).toHaveTextContent("broadly amber"));
    // The honesty label must be present so a narrative is never read as a backend fact.
    expect(screen.getByText("AI · GENERATED")).toBeInTheDocument();
  });

  it("shows a plain error (no narrative) when the capability is off → 403", async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: "AI portfolio insights are unavailable here" }, false, 403));
    renderWithProviders(<InsightsPanel />);
    fireEvent.click(screen.getByTestId("insight-risk-outlook"));
    await waitFor(() => expect(screen.getByTestId("insight-error")).toBeInTheDocument());
    expect(screen.queryByTestId("insight-narrative")).toBeNull();
  });
});
