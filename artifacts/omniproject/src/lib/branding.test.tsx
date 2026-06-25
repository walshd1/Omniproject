import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrandingProvider, useBranding } from "./branding";

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <BrandingProvider>{children}</BrandingProvider>
    </QueryClientProvider>
  );
}

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
}

describe("useBranding", () => {
  it("exposes the default branding when no data is seeded", () => {
    const qc = freshClient();
    // No branding query seeded; provider falls back to DEFAULTS.
    const { result } = renderHook(() => useBranding(), { wrapper: makeWrapper(qc) });
    expect(result.current.appName).toBe("OmniProject");
    expect(result.current.shortName).toBe("OP");
    expect(result.current.entitled).toBe(false);
  });

  it("reflects seeded branding and sets the document title", async () => {
    const qc = freshClient();
    qc.setQueryData(["branding"], {
      appName: "Acme PM",
      shortName: "AC",
      logoUrl: "",
      primaryColor: "#ff0000",
      loginHeading: "Welcome",
      footerText: "© Acme",
      supportUrl: "",
      entitled: true,
      locked: false,
    });
    const { result } = renderHook(() => useBranding(), { wrapper: makeWrapper(qc) });
    expect(result.current.appName).toBe("Acme PM");
    expect(result.current.entitled).toBe(true);
    await waitFor(() => expect(document.title).toBe("Acme PM"));
    expect(document.documentElement.style.getPropertyValue("--brand-primary")).toBe("#ff0000");
  });

  it("removes the brand colour property when primaryColor is empty", async () => {
    document.documentElement.style.setProperty("--brand-primary", "#123456");
    const qc = freshClient();
    qc.setQueryData(["branding"], {
      appName: "Plain",
      shortName: "PL",
      logoUrl: "",
      primaryColor: "",
      loginHeading: "",
      footerText: "",
      supportUrl: "",
      entitled: false,
      locked: false,
    });
    renderHook(() => useBranding(), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(document.title).toBe("Plain"));
    expect(document.documentElement.style.getPropertyValue("--brand-primary")).toBe("");
  });
});
