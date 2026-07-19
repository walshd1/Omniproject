import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { OrgIdentityStep } from "./OrgIdentityStep";
import { InviteTeamStep } from "./InviteTeamStep";

/** The first-run wizard steps: name your organisation (branding) + add your team (identity provider). */

let branding = { appName: "OmniProject", entitled: true, locked: false };
vi.mock("../../lib/branding", () => ({ useBranding: () => branding }));

const wrap = (node: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};

describe("OrgIdentityStep", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => { branding = { appName: "OmniProject", entitled: true, locked: false }; });

  it("when entitled, names the org via PUT /api/branding", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    wrap(<OrgIdentityStep isAdmin />);
    fireEvent.change(screen.getByTestId("org-name-input"), { target: { value: "Acme Inc." } });
    fireEvent.click(screen.getByTestId("org-name-save"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/branding", expect.objectContaining({ method: "PUT" })));
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ appName: "Acme Inc." });
  });

  it("when NOT entitled, shows the branding upsell instead of an input", () => {
    branding = { appName: "OmniProject", entitled: false, locked: true };
    wrap(<OrgIdentityStep isAdmin />);
    expect(screen.queryByTestId("org-name-input")).toBeNull();
    expect(screen.getByTestId("org-name-locked")).toHaveTextContent(/Branding/i);
  });
});

describe("InviteTeamStep", () => {
  it("explains people come via the identity provider", () => {
    render(<InviteTeamStep authMode="oidc" />);
    expect(screen.getByTestId("invite-team-step")).toHaveTextContent(/identity provider/i);
    expect(screen.queryByTestId("invite-team-demo-warning")).toBeNull();
  });

  it("warns about the wide-open posture in demo mode", () => {
    render(<InviteTeamStep authMode="demo" />);
    expect(screen.getByTestId("invite-team-demo-warning")).toHaveTextContent(/demo mode/i);
  });
});
