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
    const setOrClear = (prop: string, v: string | undefined) => (v ? root.style.setProperty(prop, v) : root.style.removeProperty(prop));
    // Validate the server/licence-supplied brand tokens before injecting them as CSS custom
    // properties: a colour must look like a colour, and a font-family must be a plain list of
    // font-name tokens — so a value like `url(...)`/expression can't ride in via the branding feed.
    const COLOUR = /^(#[0-9a-fA-F]{3,8}|rgb\(|rgba\(|hsl\(|hsla\(|[a-zA-Z]+)$/;
    const FONT_FAMILY = /^[\w\s,'"-]+$/;
    setOrClear("--brand-primary", COLOUR.test(value.primaryColor ?? "") ? value.primaryColor : undefined);
    // Customer brand FONT FAMILY (applied on all screens). Font SIZE + background
    // COLOUR are per-user (lib/a11y-prefs), not part of the company branding.
    setOrClear("--brand-font-family", FONT_FAMILY.test(value.fontFamily ?? "") ? value.fontFamily : undefined);
  }, [value.appName, value.primaryColor, value.fontFamily]);

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
