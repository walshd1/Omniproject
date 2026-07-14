import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { SettingsPresetPicker } from "./SettingsPresetPicker";

const PRESETS = {
  presets: [
    {
      id: "enterprise-pmo",
      label: "Enterprise PMO",
      audience: "Large enterprises with a PMO",
      description: "Portfolio-grade rigour.",
      settings: { deploymentProfile: "enterprise", reportingCurrency: "USD", fxRatePolicy: "periodClose" },
    },
    { id: "demo-trial", label: "Demo / Trial", audience: "Evaluators", description: "Everything on.", settings: { deploymentProfile: "demo" } },
  ],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/settings/presets")) return new Response(JSON.stringify(PRESETS), { status: 200 });
    if (u.includes("/api/settings") && init?.method === "PATCH") return new Response(JSON.stringify({}), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  }));
});
afterEach(() => vi.restoreAllMocks());

describe("SettingsPresetPicker", () => {
  it("lists the blueprints with their audience + description", async () => {
    renderWithProviders(<SettingsPresetPicker />);
    expect(await screen.findByText("Enterprise PMO")).toBeInTheDocument();
    expect(screen.getByText(/Large enterprises with a PMO/)).toBeInTheDocument();
    expect(screen.getByText("Demo / Trial")).toBeInTheDocument();
  });

  it("applies a blueprint as a settings PATCH when its Load button is clicked", async () => {
    renderWithProviders(<SettingsPresetPicker />);
    fireEvent.click(await screen.findByTestId("preset-apply-enterprise-pmo"));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/settings"),
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });

  it("disables the Load buttons for a non-admin", async () => {
    renderWithProviders(<SettingsPresetPicker isAdmin={false} />);
    expect(await screen.findByTestId("preset-apply-demo-trial")).toBeDisabled();
    expect(screen.getByText(/Sign in as an admin to load a blueprint/i)).toBeInTheDocument();
  });
});
