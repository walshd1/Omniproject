import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { ProfileStep } from "./ProfileStep";
import type { DeploymentProfileView, ProfilePosture, CharityOnboardingResult } from "../../lib/deployment-profile";

const posture = (over: Partial<ProfilePosture>): ProfilePosture => ({
  label: "X", audience: "aud", tls: "lan-ok", demoAuthSeverity: "warn", summary: "s", relaxes: [], presetEnv: [], recommend: [], ...over,
});

const CHARITY_RESULT: CharityOnboardingResult = {
  profile: "nonprofit",
  posture: posture({ label: "Non-profit / charity" }),
  dashboardsAdded: [{ id: "d1", name: "Trustee report" }, { id: "d2", name: "Funder report" }],
  nomenclature: { applied: false, backendId: "all", reason: "no nomenclature preset for backend \"all\"" },
};

const VIEW: DeploymentProfileView = {
  profile: "business",
  posture: posture({ label: "Business / SME" }),
  tls: { servedOverTls: true },
  demoAuth: { active: false, accepted: false, severity: "critical" },
  hardening: { oidc: true, scim: false, ipAllowlist: false, sessionCap: false, kms: false, makerChecker: false, securityStrict: false, rateLimit: true, strongMfaAdminPmo: true },
  profiles: ["enterprise", "business", "nonprofit", "self-hosted", "demo"],
  catalogue: {
    enterprise: posture({ label: "Enterprise", audience: "Large org", presetEnv: [{ key: "SCIM_TOKEN", why: "provisioning" }] }),
    business: posture({ label: "Business / SME", audience: "A company" }),
    nonprofit: posture({ label: "Non-profit / charity", audience: "Charity", relaxes: ["Plain HTTP on a LAN"] }),
    "self-hosted": posture({ label: "Self-hosted / homelab", audience: "Homelab", relaxes: ["Single-admin demo auth"] }),
    demo: posture({ label: "Demo", audience: "Eval" }),
  },
};

function seed(role: string | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(["deployment-profile"], VIEW);
  return qc;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((url: string, init?: { method?: string }) => {
    if (!init?.method || init.method === "GET") return Promise.resolve({ ok: true, json: () => Promise.resolve(VIEW) });
    if (String(url).includes("/api/setup/charity-onboarding")) return Promise.resolve({ ok: true, json: () => Promise.resolve(CHARITY_RESULT) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ profile: "nonprofit" }) });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("ProfileStep", () => {
  it("renders a card per customer type, marking the active one", () => {
    renderWithProviders(<ProfileStep isAdmin />, { client: seed("admin") });
    expect(screen.getByTestId("profile-step")).toBeInTheDocument();
    for (const id of ["enterprise", "business", "nonprofit", "self-hosted", "demo"]) {
      expect(screen.getByTestId(`profile-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("profile-business")).toHaveAttribute("aria-pressed", "true");
    // Presets/relaxations show.
    expect(screen.getByText(/Plain HTTP on a LAN/)).toBeInTheDocument();
    expect(screen.getByText(/SCIM_TOKEN/)).toBeInTheDocument();
  });

  it("persists a new choice via POST", async () => {
    renderWithProviders(<ProfileStep isAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("profile-nonprofit"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/setup/profile") && (c[1] as { method?: string })?.method === "POST");
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ profile: "nonprofit" });
    });
  });

  it("is non-interactive for a non-admin", () => {
    renderWithProviders(<ProfileStep isAdmin={false} />, { client: seed("viewer") });
    fireEvent.click(screen.getByTestId("profile-nonprofit"));
    expect(fetchMock.mock.calls.some((c) => (c[1] as { method?: string })?.method === "POST")).toBe(false);
  });

  describe("We're a charity — one-click preset", () => {
    it("renders a real, keyboard-operable button and applies the preset on click", async () => {
      renderWithProviders(<ProfileStep isAdmin />, { client: seed("admin") });
      const button = screen.getByTestId("charity-onboarding-apply");
      expect(button.tagName).toBe("BUTTON"); // native button = keyboard-operable for free
      fireEvent.click(button);
      await waitFor(() => {
        const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/setup/charity-onboarding"));
        expect(call).toBeTruthy();
        expect((call![1] as { method?: string }).method).toBe("POST");
      });
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Trustee report/);
        expect(screen.getByRole("status")).toHaveTextContent(/Funder report/);
      });
    });

    it("does nothing for a non-admin", () => {
      renderWithProviders(<ProfileStep isAdmin={false} />, { client: seed("viewer") });
      const button = screen.getByTestId("charity-onboarding-apply");
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/setup/charity-onboarding"))).toBe(false);
    });
  });
});
