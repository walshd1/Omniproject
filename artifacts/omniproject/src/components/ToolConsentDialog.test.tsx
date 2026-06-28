import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { ToolConsentDialog } from "./ToolConsentDialog";
import type { ResolvedTool } from "../lib/tools";

/**
 * The consent gate spells out where data goes and records consent on acceptance.
 */
const cloudTool: ResolvedTool = {
  id: "portfolio-copilot",
  label: "Portfolio copilot",
  description: "Natural-language questions over the portfolio.",
  egressModes: ["self-hosted", "third-party"],
  available: true,
  effectiveEgress: "third-party",
  requiresConsent: true,
  consented: false,
  reason: null,
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ consented: ["portfolio-copilot"] }) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("ToolConsentDialog", () => {
  it("shows the effective egress destination and the tool's purpose", () => {
    renderWithProviders(<ToolConsentDialog tool={cloudTool} open onOpenChange={() => {}} />);
    expect(screen.getByTestId("tool-consent-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("tool-egress")).toHaveTextContent("Third-party cloud");
    expect(screen.getByText(/Enable Portfolio copilot/)).toBeInTheDocument();
  });

  it("records consent and closes on acceptance", async () => {
    const onOpenChange = vi.fn();
    const onConsented = vi.fn();
    renderWithProviders(<ToolConsentDialog tool={cloudTool} open onOpenChange={onOpenChange} onConsented={onConsented} />);
    fireEvent.click(screen.getByTestId("tool-consent-accept"));
    await waitFor(() => expect(onConsented).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/tools/portfolio-copilot/consent", expect.objectContaining({ method: "POST" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
