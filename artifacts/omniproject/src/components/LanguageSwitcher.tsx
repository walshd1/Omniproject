import { Languages } from "lucide-react";
import { useT, LOCALES, LOCALE_NAMES, type Locale } from "../lib/i18n";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useT();
  return (
    <label className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground" title={t("header.language")}>
      <Languages className="w-4 h-4" />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        aria-label={t("header.language")}
        className="bg-transparent text-xs font-bold uppercase tracking-widest outline-none cursor-pointer"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} className="bg-background text-foreground normal-case">{LOCALE_NAMES[l]}</option>
        ))}
      </select>
    </label>
  );
}
