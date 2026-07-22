import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PresetStep } from "./PresetStep";

/**
 * The preset-driven Configurator entry: picking a preset runs the whole bundle — the server-side apply
 * (ruleset + starter project), then the SPA follow-ups (posture blueprint + methodology composition) — and
 * shows a result summary. We mock the network-backed hooks and assert the orchestration fires each step.
 */

const applyPreset = vi.fn();
const updateSettings = vi.fn();
const saveComposition = vi.fn();

vi.mock("../../lib/presets", () => ({
  usePresets: () => ({ data: [
    { id: "enterprise-scrum", label: "Enterprise Scrum", description: "Governed Scrum at scale.", methodology: "scrum", settingsPreset: "enterprise-pmo", tags: ["agile", "enterprise"], order: 20 },
  ] }),
  useApplyPreset: () => ({ mutateAsync: applyPreset }),
}));
vi.mock("@workspace/api-client-react", () => ({ useUpdateSettings: () => ({ mutateAsync: updateSettings }) }));
vi.mock("../../lib/settings-presets", () => ({
  useSettingsPresets: () => ({ presets: [{ id: "enterprise-pmo", label: "Enterprise PMO", audience: "Enterprise", description: "d", settings: { reportingCurrency: "USD" } }], isLoading: false }),
}));
vi.mock("../../lib/methodology-composition-api", () => ({ useSaveMethodologyComposition: () => ({ mutateAsync: saveComposition }) }));

const wrap = (node: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};

describe("PresetStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyPreset.mockResolvedValue({
      presetId: "enterprise-scrum", methodology: "scrum",
      applied: { referenceRuleset: "scrum", project: { id: "proj-1", seeded: 4 } },
      followUps: { methodologyComposition: "scrum", settingsPreset: "enterprise-pmo", dashboardPreset: "head-of-projects-today" },
    });
    updateSettings.mockResolvedValue({});
    saveComposition.mockResolvedValue(undefined);
  });

  it("lists presets and, on load, applies the bundle + blueprint + composition and shows a summary", async () => {
    wrap(<PresetStep isAdmin />);
    expect(screen.getByTestId("preset-card-enterprise-scrum")).toHaveTextContent("Enterprise Scrum");

    fireEvent.click(screen.getByTestId("preset-load-enterprise-scrum"));

    // 1) The server-side bundle apply …
    await waitFor(() => expect(applyPreset).toHaveBeenCalledWith({ id: "enterprise-scrum" }));
    // 2) … the posture blueprint (the enterprise-pmo settings) …
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ data: { reportingCurrency: "USD" } }));
    // 3) … and the methodology composition (a non-empty curated item set for scrum).
    await waitFor(() => expect(saveComposition).toHaveBeenCalledTimes(1));
    const composition = saveComposition.mock.calls[0]![0] as string[];
    expect(Array.isArray(composition)).toBe(true);
    expect(composition.length).toBeGreaterThan(0);

    // The result summary reflects what happened.
    const summary = await screen.findByTestId("preset-applied-enterprise-scrum");
    expect(summary).toHaveTextContent(/Enterprise Scrum loaded/i);
    expect(summary).toHaveTextContent(/starter project with 4 work items/i);
    expect(summary).toHaveTextContent(/scrum reference ruleset/i);
  });

  it("is inert for a non-admin (the load button is disabled)", () => {
    wrap(<PresetStep isAdmin={false} />);
    expect(screen.getByTestId("preset-load-enterprise-scrum")).toBeDisabled();
    fireEvent.click(screen.getByTestId("preset-load-enterprise-scrum"));
    expect(applyPreset).not.toHaveBeenCalled();
  });
});
