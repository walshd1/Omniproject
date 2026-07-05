import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetSettingsQueryKey,
  type Settings as SettingsType,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { A11yProvider } from "../lib/a11y-prefs";
import { PlatformProvider } from "../lib/platform-context";
import { Toaster } from "../components/ui/toaster";
import { Settings } from "./Settings";

// Settings.tsx assembles ~30 independent admin panels below its own form, each with its own
// data-fetching assumptions (several expect a specific object/array shape and crash on the
// generic `{}` fallback `mockFetchRouter` returns for anything un-seeded). None of that is
// Settings.tsx's own logic — every one of these already has its own dedicated test file — so
// they're stubbed out here to keep this file scoped to Settings.tsx's own form/submit/loading/
// error/testAi behavior instead of playing whack-a-mole with every child's query shape.
vi.mock("../components/PremiumAdmin", () => ({ PremiumAdmin: () => null }));
vi.mock("../components/settings/LoggingSyncSettings", () => ({ LoggingSyncSettings: () => null }));
vi.mock("../components/settings/TranslationLayer", () => ({ TranslationLayer: () => null }));
vi.mock("../components/settings/BrokerLog", () => ({ BrokerLog: () => null }));
vi.mock("../components/settings/A11yControls", () => ({ A11yControls: () => null }));
vi.mock("../components/settings/PerformanceSettings", () => ({ PerformanceSettings: () => null }));
vi.mock("../components/settings/GovernanceAdmin", () => ({ GovernanceAdmin: () => null }));
vi.mock("../components/settings/ActionCatalogue", () => ({ ActionCatalogue: () => null }));
vi.mock("../components/settings/AiProvidersAdmin", () => ({ AiProvidersAdmin: () => null }));
vi.mock("../components/settings/GovernanceDashboard", () => ({ GovernanceDashboard: () => null }));
vi.mock("../components/settings/DeploymentProfile", () => ({ DeploymentProfile: () => null }));
vi.mock("../components/settings/FeatureModulesAdmin", () => ({ FeatureModulesAdmin: () => null }));
vi.mock("../components/settings/RateCardAdmin", () => ({ RateCardAdmin: () => null }));
vi.mock("../components/settings/RateGridAdmin", () => ({ RateGridAdmin: () => null }));
vi.mock("../components/settings/IdentityMapAdmin", () => ({ IdentityMapAdmin: () => null }));
vi.mock("../components/settings/CostRulesAdmin", () => ({ CostRulesAdmin: () => null }));
vi.mock("../components/settings/CustomReportsAdmin", () => ({ CustomReportsAdmin: () => null }));
vi.mock("../components/settings/CustomBackendAdmin", () => ({ CustomBackendAdmin: () => null }));
vi.mock("../components/settings/ContentPagesAdmin", () => ({ ContentPagesAdmin: () => null }));
vi.mock("../components/settings/FederatedPeersAdmin", () => ({ FederatedPeersAdmin: () => null }));
vi.mock("../components/settings/PriorityWeightsAdmin", () => ({ PriorityWeightsAdmin: () => null }));
vi.mock("../components/settings/GovernanceRulesAdmin", () => ({ GovernanceRulesAdmin: () => null }));
vi.mock("../components/settings/ScopeUpliftAdmin", () => ({ ScopeUpliftAdmin: () => null }));
vi.mock("../components/settings/FeatureGovernance", () => ({ FeatureGovernance: () => null }));
vi.mock("../components/settings/FeatureGatingBulkAdmin", () => ({ FeatureGatingBulkAdmin: () => null }));
vi.mock("../components/settings/FieldVisibilityAdmin", () => ({ FieldVisibilityAdmin: () => null }));
vi.mock("../components/settings/SecurityKeys", () => ({ SecurityKeys: () => null }));
vi.mock("../components/settings/ProvenanceDashboard", () => ({ ProvenanceDashboard: () => null }));
vi.mock("../components/settings/NlCommand", () => ({ NlCommand: () => null }));
vi.mock("../components/settings/HealthWatch", () => ({ HealthWatch: () => null }));
vi.mock("../components/settings/Copilot", () => ({ Copilot: () => null }));

function settings(over: Partial<SettingsType> = {}): SettingsType {
  return {
    brokerUrl: "https://broker.example.com/webhook/abc",
    aiProvider: "none",
    aiModel: "",
    backendSource: "all",
    oidcIssuerUrl: "",
    ...over,
  };
}

function seed(s: SettingsType | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (s) qc.setQueryData(getGetSettingsQueryKey(), s);
  // Settings' own backend-id datalist query; seed so it doesn't fall through to the generic
  // `{}` stub (not an array) once a test lives past the first tick.
  qc.setQueryData(["setup-backend-ids"], []);
  return qc;
}

function renderSettings(client: QueryClient) {
  return renderWithProviders(
    <A11yProvider><PlatformProvider><Settings /><Toaster /></PlatformProvider></A11yProvider>,
    { client },
  );
}

// Routes a request by URL pathname to a canned response; anything not listed falls back to a
// no-op 200 (matching the blanket stub the other tests in this file rely on), so a test only
// needs to describe the one or two endpoints it actually cares about.
function mockFetchRouter(routes: Record<string, { ok: boolean; status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    const path = new URL(href, "http://localhost").pathname;
    const route = routes[path] ?? { ok: true, body: {} };
    return {
      ok: route.ok,
      status: route.status ?? (route.ok ? 200 : 500),
      statusText: route.ok ? "OK" : "Error",
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(route.body ?? {}),
      text: () => Promise.resolve(JSON.stringify(route.body ?? {})),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

beforeEach(() => {
  // Any stray query falls back to a no-op fetch instead of hitting the network.
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
});

describe("Settings", () => {
  it("renders the configuration form sections seeded from settings", () => {
    renderWithProviders(<A11yProvider><PlatformProvider><Settings /></PlatformProvider></A11yProvider>, { client: seed(settings()) });
    expect(screen.getByRole("heading", { level: 1, name: /system configuration/i })).toBeInTheDocument();
    expect(screen.getByText(/orchestration/i)).toBeInTheDocument();
    expect(screen.getByText(/ai model/i)).toBeInTheDocument();
    expect(screen.getByText(/identity/i)).toBeInTheDocument();
    // broker URL input pre-filled from seeded settings
    expect(screen.getByDisplayValue("https://broker.example.com/webhook/abc")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /commit changes/i })).toBeInTheDocument();
  });

  it("shows the model field only when an AI provider is selected", () => {
    renderWithProviders(<A11yProvider><PlatformProvider><Settings /></PlatformProvider></A11yProvider>, { client: seed(settings({ aiProvider: "openai", aiModel: "gpt-4o-mini" })) });
    expect(screen.getByText(/^model$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /test connection/i })).toBeInTheDocument();
  });

  it("hides the model field when the provider is none", () => {
    renderWithProviders(<A11yProvider><PlatformProvider><Settings /></PlatformProvider></A11yProvider>, { client: seed(settings({ aiProvider: "none" })) });
    expect(screen.queryByRole("button", { name: /test connection/i })).not.toBeInTheDocument();
  });

  it("shows the FX as-of-date input only when the policy isn't spot", () => {
    renderWithProviders(<A11yProvider><PlatformProvider><Settings /></PlatformProvider></A11yProvider>, { client: seed(settings({ fxRatePolicy: "spot" })) });
    expect(screen.getByText(/fx as-of-date policy/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^$/i, { selector: "#fx-rate-as-of-date" })).not.toBeInTheDocument();
  });

  it("pre-fills the FX as-of-date once the policy is period-close", () => {
    renderWithProviders(<A11yProvider><PlatformProvider><Settings /></PlatformProvider></A11yProvider>, { client: seed(settings({ fxRatePolicy: "periodClose", fxRateAsOfDate: "2026-06-30" })) });
    expect(screen.getByDisplayValue("2026-06-30")).toBeInTheDocument();
  });
});

/**
 * Data-fetch states, URL validation, save (success/failure), and the AI connection test — none
 * of the tests above ever submit the form, drive the settings query to error, or click "Test
 * connection", so all of that is genuinely new coverage.
 */
describe("Settings interactions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the loading state before settings have loaded", () => {
    renderSettings(seed(undefined));
    expect(screen.getByText("LOADING…")).toBeInTheDocument();
  });

  it("shows an error state when the settings fetch fails, and retries on click", async () => {
    const calls = mockFetchRouter({ "/api/settings": { ok: false, status: 500 } });
    renderSettings(seed(undefined));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load");
    const before = calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(calls.length).toBeGreaterThan(before);
  });

  it("shows a validation error for a malformed broker URL and disables submit", async () => {
    const user = userEvent.setup();
    renderSettings(seed(settings()));
    const input = screen.getByDisplayValue("https://broker.example.com/webhook/abc");
    await user.clear(input);
    await user.type(input, "not a url");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid URL (including http:// or https://).");
    expect(screen.getByRole("button", { name: /commit changes/i })).toBeDisabled();
  });

  it("saves settings on submit, toasts, and sends the form data as the PATCH body", async () => {
    const user = userEvent.setup();
    const calls = mockFetchRouter({});
    renderSettings(seed(settings({ reportingCurrency: "gbp" })));
    await user.click(screen.getByRole("button", { name: /commit changes/i }));

    expect(await screen.findByText("SETTINGS SAVED")).toBeInTheDocument();
    const patchCall = calls.find((c) => new URL(c.url, "http://localhost").pathname === "/api/settings" && c.init?.method === "PATCH");
    expect(patchCall).toBeTruthy();
    const body = JSON.parse(String(patchCall!.init!.body));
    expect(body.reportingCurrency).toBe("GBP");
  });

  it("shows a generic error toast and re-enables submit when saving fails", async () => {
    const user = userEvent.setup();
    mockFetchRouter({ "/api/settings": { ok: false, status: 500 } });
    renderSettings(seed(settings()));
    await user.click(screen.getByRole("button", { name: /commit changes/i }));

    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Failed to save settings.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /commit changes/i })).toBeEnabled();
  });

  it("tests the AI connection and shows a ready status", async () => {
    const user = userEvent.setup();
    mockFetchRouter({
      "/api/ai/status": { ok: true, body: { provider: "openai", model: "gpt-4o-mini", configured: true, detail: "Reachable" } },
    });
    renderSettings(seed(settings({ aiProvider: "openai", aiModel: "gpt-4o-mini" })));
    await user.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/READY/)).toBeInTheDocument();
    expect(screen.getByText(/Reachable/)).toBeInTheDocument();
  });

  it("shows an error toast when the AI status check fails", async () => {
    const user = userEvent.setup();
    mockFetchRouter({ "/api/ai/status": { ok: false, status: 500 } });
    renderSettings(seed(settings({ aiProvider: "openai" })));
    await user.click(screen.getByRole("button", { name: /test connection/i }));

    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Could not reach AI status.")).toBeInTheDocument();
  });
});
