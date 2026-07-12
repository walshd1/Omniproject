import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";

/**
 * Dependency-free internationalization.
 *
 * A small translation dictionary + Intl-based number/date/currency formatting.
 * The active locale also drives currency/number formatting app-wide, which is
 * what makes the multi-currency reporting render correctly per region.
 *
 * Add a locale: add its code to LOCALES and a column to TRANSLATIONS. Add a
 * string: add a key to every locale (missing keys fall back to English).
 */

export const LOCALES = ["en", "fr", "de", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
};

type Dict = Record<string, string>;

const EN: Dict = {
  "nav.dashboard": "Dashboard",
  "nav.myWork": "My Work",
  "nav.nextActions": "Next Actions",
  "nav.dashboards": "Dashboards",
  "nav.content": "Content",
  "nav.programmes": "Programmes",
  "nav.projects": "Projects",
  "nav.reports": "Reports",
  "nav.resources": "Resources",
  "nav.explore": "Explore",
  "nav.settings": "Settings",
  "nav.configurator": "Configurator",
  "nav.advanced": "Advanced",
  "header.connected": "Connected",
  "header.offline": "Offline",
  "header.signOut": "Sign out",
  "header.search": "Cmd+K to search",
  "header.demoBanner": "Demo mode — showing sample data. Connect your broker + backend to go live.",
  "header.openSetup": "Open configurator →",
  "header.language": "Language",
  "common.loading": "Loading…",
  "common.none": "None",
  "common.unread": "{n} unread",
  "reports.title": "Enterprise Reporting",
  "reports.portfolioHealth": "Portfolio Health",
  "reports.resourceAllocation": "Resource Allocation",
  "reports.earnedValue": "Earned Value (EVM)",
  "reports.progressTrend": "Progress Trend",
  "reports.displayCurrency": "Display currency",
  "reports.notAvailable": "Not available for this backend",
  "notifications.title": "Notifications",
  "notifications.nothingNew": "Nothing new.",
  "notifications.live": "Live",
  "setup.title": "Connection Center",
};

// Curated translations for the high-traffic surfaces. English is the fallback
// for any key not present in a locale.
const FR: Dict = {
  "nav.dashboard": "Tableau de bord",
  "nav.myWork": "Mon travail",
  "nav.nextActions": "Actions à venir",
  "nav.dashboards": "Tableaux de bord",
  "nav.content": "Contenu",
  "nav.programmes": "Programmes",
  "nav.projects": "Projets",
  "nav.reports": "Rapports",
  "nav.resources": "Ressources",
  "nav.explore": "Explorer",
  "nav.settings": "Paramètres",
  "nav.configurator": "Configurateur",
  "nav.advanced": "Avancé",
  "header.connected": "Connecté",
  "header.offline": "Hors ligne",
  "header.signOut": "Se déconnecter",
  "header.search": "Cmd+K pour rechercher",
  "header.demoBanner": "Mode démo — données d'exemple. Connectez votre broker + backend pour passer en production.",
  "header.openSetup": "Ouvrir le configurateur →",
  "header.language": "Langue",
  "common.loading": "Chargement…",
  "common.none": "Aucun",
  "common.unread": "{n} non lus",
  "reports.title": "Rapports d'entreprise",
  "reports.portfolioHealth": "Santé du portefeuille",
  "reports.resourceAllocation": "Allocation des ressources",
  "reports.earnedValue": "Valeur acquise (EVM)",
  "reports.progressTrend": "Tendance d'avancement",
  "reports.displayCurrency": "Devise d'affichage",
  "reports.notAvailable": "Non disponible pour ce backend",
  "notifications.title": "Notifications",
  "notifications.nothingNew": "Rien de nouveau.",
  "notifications.live": "En direct",
  "setup.title": "Centre de connexion",
};

const DE: Dict = {
  "nav.dashboard": "Übersicht",
  "nav.myWork": "Meine Aufgaben",
  "nav.nextActions": "Nächste Aktionen",
  "nav.dashboards": "Dashboards",
  "nav.content": "Inhalte",
  "nav.programmes": "Programme",
  "nav.projects": "Projekte",
  "nav.reports": "Berichte",
  "nav.resources": "Ressourcen",
  "nav.explore": "Entdecken",
  "nav.settings": "Einstellungen",
  "nav.configurator": "Konfigurator",
  "nav.advanced": "Erweitert",
  "header.connected": "Verbunden",
  "header.offline": "Offline",
  "header.signOut": "Abmelden",
  "header.search": "Cmd+K zum Suchen",
  "header.demoBanner": "Demomodus — Beispieldaten. Verbinden Sie den Broker + Backend für den Live-Betrieb.",
  "header.openSetup": "Konfigurator öffnen →",
  "header.language": "Sprache",
  "common.loading": "Wird geladen…",
  "common.none": "Keine",
  "common.unread": "{n} ungelesen",
  "reports.title": "Unternehmensberichte",
  "reports.portfolioHealth": "Portfolio-Status",
  "reports.resourceAllocation": "Ressourcenzuordnung",
  "reports.earnedValue": "Earned Value (EVM)",
  "reports.progressTrend": "Fortschrittstrend",
  "reports.displayCurrency": "Anzeigewährung",
  "reports.notAvailable": "Für dieses Backend nicht verfügbar",
  "notifications.title": "Benachrichtigungen",
  "notifications.nothingNew": "Nichts Neues.",
  "notifications.live": "Live",
  "setup.title": "Verbindungszentrale",
};

const ES: Dict = {
  "nav.dashboard": "Panel",
  "nav.myWork": "Mi trabajo",
  "nav.nextActions": "Próximas acciones",
  "nav.dashboards": "Paneles",
  "nav.content": "Contenido",
  "nav.programmes": "Programas",
  "nav.projects": "Proyectos",
  "nav.reports": "Informes",
  "nav.resources": "Recursos",
  "nav.explore": "Explorar",
  "nav.settings": "Ajustes",
  "nav.configurator": "Configurador",
  "nav.advanced": "Avanzado",
  "header.connected": "Conectado",
  "header.offline": "Sin conexión",
  "header.signOut": "Cerrar sesión",
  "header.search": "Cmd+K para buscar",
  "header.demoBanner": "Modo demo — datos de ejemplo. Conecta tu broker + backend para producción.",
  "header.openSetup": "Abrir el configurador →",
  "header.language": "Idioma",
  "common.loading": "Cargando…",
  "common.none": "Ninguno",
  "common.unread": "{n} sin leer",
  "reports.title": "Informes empresariales",
  "reports.portfolioHealth": "Salud del portafolio",
  "reports.resourceAllocation": "Asignación de recursos",
  "reports.earnedValue": "Valor ganado (EVM)",
  "reports.progressTrend": "Tendencia de progreso",
  "reports.displayCurrency": "Moneda de visualización",
  "reports.notAvailable": "No disponible para este backend",
  "notifications.title": "Notificaciones",
  "notifications.nothingNew": "Nada nuevo.",
  "notifications.live": "En vivo",
  "setup.title": "Centro de conexión",
};

const TRANSLATIONS: Record<Locale, Dict> = { en: EN, fr: FR, de: DE, es: ES };

/**
 * Pure translation lookup with {var} interpolation and English fallback.
 *
 * Company-nomenclature `overrides` (keyed by the same i18n key) win over the
 * localized dictionaries — so a deployment that renames "Projects" to
 * "Engagements" gets that label in every locale.
 */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
  overrides?: Record<string, string>,
): string {
  const raw = overrides?.[key] ?? TRANSLATIONS[locale]?.[key] ?? EN[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_m, name) => String(vars[name] ?? `{${name}}`));
}

function detectLocale(): Locale {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("omni.locale");
    if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as Locale;
    const nav = navigator.language?.slice(0, 2);
    if (nav && (LOCALES as readonly string[]).includes(nav)) return nav as Locale;
  }
  return "en";
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => string;
  formatCurrency: (n: number, currency: string, opts?: Intl.NumberFormatOptions) => string;
  formatDate: (d: Date | string, opts?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, labelOverrides }: { children: ReactNode; labelOverrides?: Record<string, string> | undefined }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);
  // Stable reference so the memoised `t` below doesn't rebuild on every render.
  const overrides = useMemo(() => labelOverrides ?? {}, [labelOverrides]);

  const setLocale = useCallback((l: Locale) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("omni.locale", l);
    }
    setLocaleState(l);
  }, []);

  // Keep <html lang> in sync with the active locale — on first load (detected or
  // persisted) AND on every change — so assistive tech announces content correctly.
  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

  const value: I18nContextValue = {
    locale,
    setLocale,
    t: useCallback((key, vars) => translate(locale, key, vars, overrides), [locale, overrides]),
    formatNumber: useCallback((n, opts) => new Intl.NumberFormat(locale, opts).format(n), [locale]),
    formatCurrency: useCallback(
      (n, currency, opts) => {
        // A backend can supply a malformed currency code; Intl throws RangeError on it.
        // Fall back to a plain number so one bad value never blanks the whole report.
        try {
          return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0, ...opts }).format(n);
        } catch {
          return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n)} ${currency ?? ""}`.trim();
        }
      },
      [locale],
    ),
    formatDate: useCallback((d, opts) => new Intl.DateTimeFormat(locale, opts).format(typeof d === "string" ? new Date(d) : d), [locale]),
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within <I18nProvider>");
  return ctx;
}
