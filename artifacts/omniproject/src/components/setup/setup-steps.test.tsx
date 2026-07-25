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

  /** GET /api/org-identity seeds the field; the PUT under test writes back the ungated name. */
  const mockFetch = () => vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url) === "/api/org-identity") return new Response(JSON.stringify({ identity: { id: "org_x", name: "" } }), { status: 200 });
    return new Response(null, { status: 200 });
  });

  it("names the org (ungated) via PUT /api/org-identity", async () => {
    const fetchSpy = mockFetch();
    wrap(<OrgIdentityStep isAdmin />);
    fireEvent.change(screen.getByTestId("org-name-input"), { target: { value: "Acme Inc." } });
    fireEvent.click(screen.getByTestId("org-name-save"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/org-identity", expect.objectContaining({ method: "PUT" })));
    const putCall = fetchSpy.mock.calls.find((c) => c[0] === "/api/org-identity" && (c[1] as RequestInit | undefined)?.method === "PUT");
    expect(JSON.parse((putCall![1] as RequestInit).body as string)).toEqual({ name: "Acme Inc.", logo: "", showLogo: false });
  });

  it("when entitled, ALSO mirrors the name into premium branding (header/title)", async () => {
    const fetchSpy = mockFetch();
    wrap(<OrgIdentityStep isAdmin />);
    fireEvent.change(screen.getByTestId("org-name-input"), { target: { value: "Acme Inc." } });
    fireEvent.click(screen.getByTestId("org-name-save"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/branding", expect.objectContaining({ method: "PUT" })));
    const brandCall = fetchSpy.mock.calls.find((c) => c[0] === "/api/branding" && (c[1] as RequestInit | undefined)?.method === "PUT");
    expect(JSON.parse((brandCall![1] as RequestInit).body as string)).toEqual({ appName: "Acme Inc." });
  });

  it("when NOT entitled, naming still works and only the logo/white-label branding is noted as premium", async () => {
    branding = { appName: "OmniProject", entitled: false, locked: true };
    const fetchSpy = mockFetch();
    wrap(<OrgIdentityStep isAdmin />);
    // The input is present (naming is ungated) and a note explains branding is the paid part.
    expect(screen.getByTestId("org-name-input")).toBeTruthy();
    expect(screen.getByTestId("org-name-branding-note")).toHaveTextContent(/Branding/i);
    fireEvent.change(screen.getByTestId("org-name-input"), { target: { value: "Small Co" } });
    fireEvent.click(screen.getByTestId("org-name-save"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/org-identity", expect.objectContaining({ method: "PUT" })));
    // …and NO branding PUT is attempted when unentitled.
    expect(fetchSpy.mock.calls.some((c) => c[0] === "/api/branding" && (c[1] as RequestInit | undefined)?.method === "PUT")).toBe(false);
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
