import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrandingProvider, useBranding, brandTokensFromHex } from "./branding";

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
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--brand-primary")).toBe("#ff0000");
    // The brand colour feeds the ORG layer of the accent cascade as HSL channels (#ff0000 = red).
    // index.css resolves --primary = var(--user-accent, var(--brand-accent, <default>)).
    expect(root.getPropertyValue("--brand-accent")).toBe("0 100% 50%");
    expect(root.getPropertyValue("--brand-accent-fg")).toBe("220 10% 7%");
  });

  it("removes the org accent var when primaryColor is cleared", async () => {
    document.documentElement.style.setProperty("--brand-accent", "0 100% 50%");
    const qc = freshClient();
    qc.setQueryData(["branding"], {
      appName: "Plain2", shortName: "P2", logoUrl: "", primaryColor: "",
      loginHeading: "", footerText: "", supportUrl: "", entitled: false, locked: false,
    });
    renderHook(() => useBranding(), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(document.title).toBe("Plain2"));
    // Cleared brand ⇒ the override is removed so the stylesheet default accent applies.
    expect(document.documentElement.style.getPropertyValue("--brand-accent")).toBe("");
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

describe("brandTokensFromHex", () => {
  it("converts 6-digit hex to HSL channels", () => {
    expect(brandTokensFromHex("#ff0000")).toEqual({ channels: "0 100% 50%", fg: "220 10% 7%" });
    expect(brandTokensFromHex("#2563eb")?.channels).toBe("221 83% 53%");
  });
  it("expands 3-digit hex and drops the alpha byte", () => {
    expect(brandTokensFromHex("#fff")?.channels).toBe("0 0% 100%");
    expect(brandTokensFromHex("#00000080")?.channels).toBe("0 0% 0%");
  });
  it("picks a legible foreground by luminance (white on dark, near-black on light)", () => {
    expect(brandTokensFromHex("#000000")?.fg).toBe("0 0% 100%"); // white on black
    expect(brandTokensFromHex("#ffff00")?.fg).toBe("220 10% 7%"); // dark on yellow
  });
  it("returns null for non-hex input so the default accent stands", () => {
    expect(brandTokensFromHex("rebeccapurple")).toBeNull();
    expect(brandTokensFromHex("hsl(1 2% 3%)")).toBeNull();
    expect(brandTokensFromHex("#12")).toBeNull();
  });
});
