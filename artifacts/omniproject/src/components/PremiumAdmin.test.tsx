import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent } from "@testing-library/react";
import type { LicenseStatus } from "../lib/branding";
import { renderWithProviders } from "../test/utils";
import { PremiumAdmin } from "./PremiumAdmin";

function makeClient(license: LicenseStatus): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  qc.setQueryData(["license"], license);
  qc.setQueryData(["branding", "admin"], {
    appName: "OmniProject",
    shortName: "OP",
    logoUrl: "",
    primaryColor: "",
    loginHeading: "Orchestration Shell",
    footerText: "",
    supportUrl: "",
  });
  qc.setQueryData(["labels", "admin"], {
    overrides: { "nav.projects": "Engagements" },
    catalog: [{ key: "nav.projects", default: "Projects" }],
  });
  qc.setQueryData(["webhooks"], {
    entitled: true,
    events: ["notification", "audit"],
    webhooks: [
      { id: "wh1", url: "https://hooks.acme.com/op", events: ["*"], active: true, secretSet: true, description: "SIEM" },
    ],
  });
  return qc;
}

const unlicensed: LicenseStatus = {
  valid: false,
  source: "none",
  tier: "free",
  customer: null,
  features: [],
  expiresAt: null,
  expiresInDays: null,
  reason: "no key",
  catalog: ["branding", "labels", "webhooks"],
};

const licensed: LicenseStatus = {
  valid: true,
  source: "license",
  tier: "enterprise",
  customer: "Acme",
  features: ["branding", "labels", "webhooks"],
  expiresAt: "2027-01-01",
  expiresInDays: 200,
  reason: null,
  catalog: ["branding", "labels", "webhooks"],
};

describe("PremiumAdmin", () => {
  beforeEach(() => {
    // Internal panel queries are already seeded, but the queryFns reference fetch.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders all three premium panels and the unlicensed badge", () => {
    const { getByRole, getByText } = renderWithProviders(<PremiumAdmin />, { client: makeClient(unlicensed) });
    expect(getByRole("heading", { name: "Premium overlay" })).toBeInTheDocument();
    expect(getByRole("heading", { name: "White-label branding" })).toBeInTheDocument();
    expect(getByRole("heading", { name: "Company nomenclature" })).toBeInTheDocument();
    expect(getByRole("heading", { name: "Outbound webhooks" })).toBeInTheDocument();
    expect(getByText("Unlicensed")).toBeInTheDocument();
  });

  it("shows lock notices and disabled fieldsets when unlicensed", () => {
    const { getAllByText, getByPlaceholderText } = renderWithProviders(<PremiumAdmin />, {
      client: makeClient(unlicensed),
    });
    expect(getAllByText(/Licensed feature/).length).toBeGreaterThanOrEqual(3);
    // App name input is inside a disabled fieldset.
    expect(getByPlaceholderText("OmniProject")).toBeDisabled();
  });

  it("unlocks panels and shows the tier badge when licensed", () => {
    const { getByText, getByPlaceholderText, queryByText } = renderWithProviders(<PremiumAdmin />, {
      client: makeClient(licensed),
    });
    expect(getByText(/enterprise · 200d left/)).toBeInTheDocument();
    expect(queryByText(/Licensed feature/)).not.toBeInTheDocument();
    expect(getByPlaceholderText("OmniProject")).toBeEnabled();
  });

  it("renders seeded label overrides and webhook rows when licensed", () => {
    const { getByDisplayValue, getByText } = renderWithProviders(<PremiumAdmin />, {
      client: makeClient(licensed),
    });
    expect(getByDisplayValue("Engagements")).toBeInTheDocument();
    expect(getByText("https://hooks.acme.com/op")).toBeInTheDocument();
  });

  it("opens the delete-webhook confirmation dialog", async () => {
    const { getByRole, findByRole } = renderWithProviders(<PremiumAdmin />, { client: makeClient(licensed) });
    // Radix icon-only triggers don't open under userEvent in jsdom; fireEvent does.
    fireEvent.click(getByRole("button", { name: "Delete webhook" }));
    const dialog = await findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Delete webhook/);
  });
});
