import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { ImpossibleTravelBanner } from "./ImpossibleTravelBanner";

/**
 * The banner renders only when the session is authenticated AND flagged for
 * an implausible location jump — never for a logged-out visitor, and never
 * once the flag has been cleared (a step-up minted after it was raised).
 */
function clientWith(data: unknown): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(["auth", "me"], data);
  return qc;
}

describe("ImpossibleTravelBanner", () => {
  it("shows the warning with a verify action when the session is flagged", () => {
    const client = clientWith({ authenticated: true, mode: "oidc", user: { sub: "u1" }, role: "manager", impossibleTravel: true });
    renderWithProviders(<ImpossibleTravelBanner />, { client });
    const banner = screen.getByTestId("impossible-travel-banner");
    expect(banner).toHaveTextContent(/unusual location/i);
    expect(screen.getByRole("button", { name: /verify it's me/i })).toBeInTheDocument();
  });

  it("renders nothing when the session is not flagged", () => {
    const client = clientWith({ authenticated: true, mode: "oidc", user: { sub: "u1" }, role: "manager", impossibleTravel: false });
    renderWithProviders(<ImpossibleTravelBanner />, { client });
    expect(screen.queryByTestId("impossible-travel-banner")).not.toBeInTheDocument();
  });

  it("renders nothing when unauthenticated, even if flagged", () => {
    const client = clientWith({ authenticated: false, mode: "demo", user: null, role: "viewer", impossibleTravel: true });
    renderWithProviders(<ImpossibleTravelBanner />, { client });
    expect(screen.queryByTestId("impossible-travel-banner")).not.toBeInTheDocument();
  });

  it("renders nothing before the auth status has loaded", () => {
    const client = clientWith(undefined);
    renderWithProviders(<ImpossibleTravelBanner />, { client });
    expect(screen.queryByTestId("impossible-travel-banner")).not.toBeInTheDocument();
  });
});
