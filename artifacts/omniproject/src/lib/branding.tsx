import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { I18nProvider } from "./i18n";

/**
 * Branding + nomenclature provider (premium features, gated server-side).
 *
 * Fetches the *effective* white-label branding and label overrides from the
 * gateway (which serves product defaults unless a valid licence entitles them),
 * applies the brand name/colour to the document, and feeds the label overrides
 * into the i18n layer so company nomenclature renders everywhere `t()` is used.
 *
 * These endpoints are public (the login screen is branded pre-auth), so this
 * provider sits above the auth gate.
 */

export interface Branding {
  appName: string;
  shortName: string;
  logoUrl: string;
  primaryColor: string;
  loginHeading: string;
  footerText: string;
  supportUrl: string;
  fontFamily: string;
  fontScale: number;
  backgroundColor: string;
  entitled: boolean;
  locked: boolean;
}

const DEFAULTS: Branding = {
  appName: "OmniProject",
  shortName: "OP",
  logoUrl: "",
  primaryColor: "",
  loginHeading: "Orchestration Shell",
  footerText: "",
  supportUrl: "",
  fontFamily: "",
  fontScale: 1,
  backgroundColor: "",
  entitled: false,
  locked: false,
};

const BrandingContext = createContext<Branding>(DEFAULTS);

async function fetchBranding(): Promise<Branding> {
  const res = await fetch("/api/branding", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`branding fetch failed: ${res.status}`);
  return { ...DEFAULTS, ...((await res.json()) as Partial<Branding>) };
}

async function fetchLabels(): Promise<Record<string, string>> {
  const res = await fetch("/api/labels", { credentials: "same-origin" });
  if (!res.ok) return {};
  const json = (await res.json()) as { overrides?: Record<string, string> };
  return json.overrides ?? {};
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { data: branding } = useQuery({ queryKey: ["branding"], queryFn: fetchBranding, staleTime: 300_000, retry: false });
  const { data: labels } = useQuery({ queryKey: ["labels"], queryFn: fetchLabels, staleTime: 300_000, retry: false });

  const value = branding ?? DEFAULTS;

  // Reflect the brand into the document title + accent colour.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = value.appName;
    const root = document.documentElement;
    const setOrClear = (prop: string, v: string) => (v ? root.style.setProperty(prop, v) : root.style.removeProperty(prop));
    setOrClear("--brand-primary", value.primaryColor);
    // Theme: font family, base font scale, and page background — applied on ALL
    // screens via CSS custom properties (the customer's theme, stored as JSON).
    setOrClear("--brand-font-family", value.fontFamily);
    root.style.setProperty("--brand-font-scale", String(value.fontScale || 1));
    setOrClear("--brand-bg", value.backgroundColor);
  }, [value.appName, value.primaryColor, value.fontFamily, value.fontScale, value.backgroundColor]);

  return (
    <BrandingContext.Provider value={value}>
      <I18nProvider labelOverrides={labels ?? {}}>{children}</I18nProvider>
    </BrandingContext.Provider>
  );
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}

// ── Licence status (for showing locked/unlocked premium features in admin) ──────
export interface LicenseStatus {
  valid: boolean;
  source: "license" | "dev" | "none";
  tier: string;
  customer: string | null;
  features: string[];
  expiresAt: string | null;
  expiresInDays: number | null;
  reason: string | null;
  catalog: string[];
}

export function useLicense() {
  return useQuery<LicenseStatus>({
    queryKey: ["license"],
    queryFn: async () => {
      const res = await fetch("/api/license", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`license fetch failed: ${res.status}`);
      return (await res.json()) as LicenseStatus;
    },
    staleTime: 300_000,
    retry: false,
  });
}
