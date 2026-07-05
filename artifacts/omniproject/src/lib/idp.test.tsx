import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useIdp, type IdpStatus } from "./idp";

/**
 * Identity-setup guidance client: useIdp's queryFn (the only statement this file's coverage
 * baseline flagged as untested) actually hits the network and unwraps the response.
 */
const STATUS: IdpStatus = {
  mode: "oidc",
  issuer: "https://auth.example.com/application/o/omniproject/",
  issuerOrigin: "https://auth.example.com",
  bundled: true,
  callbackUrl: "https://app.example.com/api/auth/callback",
  roleGroups: [{ role: "admin", groups: ["omniproject-admins"] }],
  suggestedGroups: { admin: "omniproject-admins" },
  presets: [],
  profile: "standard",
};

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(STATUS), { status: 200, headers: { "Content-Type": "application/json" } })));
});

describe("useIdp", () => {
  it("fetches identity-setup status from /api/setup/idp", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useIdp(), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data).toEqual(STATUS);
    const [url, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(url).toBe("/api/setup/idp");
    expect((opts as RequestInit).credentials).toBe("same-origin");
  });
});
