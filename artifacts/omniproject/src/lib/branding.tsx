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

/**
 * Convert a hex brand colour (#rgb / #rrggbb / #rrggbbaa) into the app's accent token
 * form: `channels` is the "H S% L%" string consumed via `hsl(var(--primary))`, and `fg`
 * is a legible on-accent text colour (near-black or white) chosen by WCAG relative
 * luminance. Returns null for non-hex input, so the caller falls back to the default accent.
 */
export function brandTokensFromHex(colour: string): { channels: string; fg: string } | null {
  let h = colour.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6); // drop alpha — the accent is opaque
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let s = 0, hue = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  const channels = `${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
  // WCAG relative luminance → pick a foreground that stays legible on the accent.
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const fg = L > 0.179 ? "220 10% 7%" : "0 0% 100%";
  return { channels, fg };
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
    const rawColour = COLOUR.test(value.primaryColor ?? "") ? value.primaryColor : undefined;
    setOrClear("--brand-primary", rawColour);
    // Drive the LIVE accent token from the brand colour. `--primary` (and the sidebar/ring
    // variants) are consumed as `hsl(var(--primary))` throughout the app + reports, so the
    // picker value — a hex from BrandingAdmin — is converted to "H S% L%" channels here.
    // Only hex is converted (the picker's format); any other accepted colour form clears the
    // override and falls back to the default accent. `--*-foreground` is computed for legibility.
    const brand = rawColour ? brandTokensFromHex(rawColour) : null;
    const ACCENT = ["--primary", "--ring", "--sidebar-primary", "--sidebar-ring"];
    const ACCENT_FG = ["--primary-foreground", "--sidebar-primary-foreground"];
    for (const t of ACCENT) setOrClear(t, brand?.channels);
    for (const t of ACCENT_FG) setOrClear(t, brand?.fg);
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
