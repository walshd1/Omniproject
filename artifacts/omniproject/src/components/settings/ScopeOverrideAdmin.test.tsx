import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ScopeOverrideAdmin } from "./ScopeOverrideAdmin";

/**
 * ScopeOverrideAdmin — author a programme's/project's own tightened ruleset + allow-listed settings. We mock
 * the delegation-policy + scope-override hooks and assert: editors appear only once a scope id is entered,
 * the delegation gate disables an area not opened to that depth, ruleset offers tighten-only options, and
 * saving sends the right payloads.
 */
const saveRuleset = vi.fn();
const saveSettings = vi.fn();
let policy: unknown = { policy: { ruleset: "project", settings: "project", methodologyComposition: "org" }, areas: [], levels: ["org", "programme", "project", "user"] };

// STABLE references — react-query keeps `data` referentially stable across renders (structural sharing); a
// fresh object each call would make the components' `useEffect([stored])` re-fire forever. Mirror that here.
const CATALOGUE = [{ id: "due-before-start", label: "Due before start", description: "d", mode: "warn", defaultMode: "warn" }];
const RULESET_STORED = { data: { scope: "project", override: { modes: {}, fieldRules: [] } } };
const SETTINGS_STORED = { data: { scope: "project", override: {} } };
vi.mock("../../lib/delegation-policy-api", () => ({ useDelegationPolicy: () => ({ data: policy }) }));
vi.mock("../../lib/scope-override-api", () => ({
  useRulesetCatalogue: () => ({ data: CATALOGUE }),
  useRulesetScopeOverride: () => RULESET_STORED,
  useSaveRulesetScopeOverride: () => ({ mutate: saveRuleset, isPending: false }),
  useSettingsScopeOverride: () => SETTINGS_STORED,
  useSaveSettingsScopeOverride: () => ({ mutate: saveSettings, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const wrap = (node: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};

describe("ScopeOverrideAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    policy = { policy: { ruleset: "project", settings: "project", methodologyComposition: "org" }, areas: [], levels: ["org", "programme", "project", "user"] };
  });

  it("shows the editors only after a scope id is entered", () => {
    wrap(<ScopeOverrideAdmin />);
    expect(screen.queryByTestId("ruleset-override-editor")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Scope id"), { target: { value: "pr-1" } });
    expect(screen.getByTestId("ruleset-override-editor")).toBeInTheDocument();
    expect(screen.getByTestId("settings-override-editor")).toBeInTheDocument();
  });

  it("ruleset override offers only tighten-only modes (>= the org base)", () => {
    wrap(<ScopeOverrideAdmin />);
    fireEvent.change(screen.getByLabelText("Scope id"), { target: { value: "pr-1" } });
    const sel = screen.getByLabelText("Override mode for Due before start") as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.value);
    // base is warn → can inherit, warn, or hard — but NOT off (a loosening).
    expect(opts).toEqual(["", "warn", "hard"]);
  });

  it("saving a tightened rule sends the override", async () => {
    wrap(<ScopeOverrideAdmin />);
    fireEvent.change(screen.getByLabelText("Scope id"), { target: { value: "pr-1" } });
    fireEvent.change(screen.getByLabelText("Override mode for Due before start"), { target: { value: "hard" } });
    fireEvent.click(screen.getByTestId("ruleset-override-save"));
    await waitFor(() => expect(saveRuleset).toHaveBeenCalledWith(
      { scope: { kind: "project", id: "pr-1" }, override: { modes: { "due-before-start": "hard" }, fieldRules: [] } },
      expect.any(Object),
    ));
  });

  it("saving a settings override sends the patch", async () => {
    wrap(<ScopeOverrideAdmin />);
    fireEvent.change(screen.getByLabelText("Scope id"), { target: { value: "pr-1" } });
    fireEvent.change(screen.getByLabelText("Reporting currency"), { target: { value: "eur" } });
    fireEvent.click(screen.getByTestId("settings-override-save"));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { kind: "project", id: "pr-1" }, patch: expect.objectContaining({ reportingCurrency: "EUR" }) }),
      expect.any(Object),
    ));
  });

  it("disables an area the delegation policy hasn't opened to this depth", () => {
    policy = { policy: { ruleset: "org", settings: "project", methodologyComposition: "org" }, areas: [], levels: ["org", "programme", "project", "user"] };
    wrap(<ScopeOverrideAdmin />);
    fireEvent.change(screen.getByLabelText("Scope id"), { target: { value: "pr-1" } });
    // ruleset is org-only → no save button, a guard note instead; settings is open → save present.
    expect(screen.queryByTestId("ruleset-override-save")).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-override-save")).toBeInTheDocument();
    expect(screen.getByText(/only allowed down to/i)).toBeInTheDocument();
  });
});
