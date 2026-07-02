import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetSettingsQueryKey,
  type Settings as SettingsType,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { A11yProvider } from "../lib/a11y-prefs";
import { PlatformProvider } from "../lib/platform-context";
import { Settings } from "./Settings";

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
  // PremiumAdmin reads license + admin branding; seed to keep it offline.
  qc.setQueryData(["license"], {
    valid: false,
    source: "none",
    tier: "free",
    customer: null,
    features: [],
    expiresAt: null,
    expiresInDays: null,
    reason: null,
    catalog: [],
  });
  qc.setQueryData(["branding", "admin"], {});
  return qc;
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
