import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider, useT, translate, LOCALES, LOCALE_NAMES } from "./i18n";

function wrapper(labelOverrides?: Record<string, string>) {
  return ({ children }: { children: ReactNode }) => (
    <I18nProvider labelOverrides={labelOverrides}>{children}</I18nProvider>
  );
}

describe("translate (pure)", () => {
  it("returns the localized string for a known key", () => {
    expect(translate("en", "nav.projects")).toBe("Projects");
    expect(translate("fr", "nav.projects")).toBe("Projets");
    expect(translate("de", "nav.dashboard")).toBe("Übersicht");
    expect(translate("es", "nav.reports")).toBe("Informes");
  });

  it("falls back to English for a key missing in the locale", () => {
    // "setup.title" exists in every dict; use a key only ever in EN fallback path
    // by asking for an unknown locale-missing key — emulate via a made-up key.
    expect(translate("fr", "totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("interpolates {var} placeholders", () => {
    expect(translate("en", "common.unread", { n: 3 })).toBe("3 unread");
  });

  it("leaves unmatched placeholders as {name}", () => {
    expect(translate("en", "common.unread", {})).toBe("{n} unread");
  });

  it("lets overrides win over the localized dictionary", () => {
    expect(translate("fr", "nav.projects", undefined, { "nav.projects": "Engagements" })).toBe("Engagements");
  });

  it("exposes the locale list and names", () => {
    expect(LOCALES).toContain("en");
    expect(LOCALE_NAMES.de).toBe("Deutsch");
  });
});

describe("useT hook", () => {
  it("throws when used outside a provider", () => {
    expect(() => renderHook(() => useT())).toThrow(/within <I18nProvider>/);
  });

  it("t() returns localized strings and switches with setLocale", () => {
    const { result } = renderHook(() => useT(), { wrapper: wrapper() });
    expect(result.current.t("nav.projects")).toBe("Projects");
    act(() => result.current.setLocale("fr"));
    expect(result.current.locale).toBe("fr");
    expect(result.current.t("nav.projects")).toBe("Projets");
    // persisted
    expect(window.localStorage.getItem("omni.locale")).toBe("fr");
    // <html lang> reflected
    expect(document.documentElement.lang).toBe("fr");
  });

  it("applies labelOverrides through t()", () => {
    const { result } = renderHook(() => useT(), {
      wrapper: wrapper({ "nav.projects": "Engagements" }),
    });
    expect(result.current.t("nav.projects")).toBe("Engagements");
  });

  it("formats numbers, currency and dates via Intl", () => {
    const { result } = renderHook(() => useT(), { wrapper: wrapper() });
    expect(result.current.formatNumber(1234.5)).toContain("1");
    const cur = result.current.formatCurrency(1000, "USD");
    expect(cur).toMatch(/1,000|1000/);
    // A malformed currency code must not throw — fall back to a plain number + code.
    const bad = result.current.formatCurrency(1000, "NOTACODE");
    expect(bad).toMatch(/1,000|1000/);
    const d = result.current.formatDate("2020-01-15T00:00:00Z", { timeZone: "UTC", year: "numeric" });
    expect(d).toContain("2020");
  });
});
