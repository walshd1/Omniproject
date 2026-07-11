import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * A percentage <input> bound to a 0–1 fraction (so 20 ↔ 0.2). Shared by the rate-card / cost-rule
 * editors. Empty ⇒ `undefined`, for optional margin/overhead fields that fall back to a default.
 *
 * While focused it renders a local string buffer of exactly what the user typed, so a partial
 * decimal ("7." on the way to "7.5") isn't rounded back to a whole percent on each keystroke — the
 * controlled value only re-derives from the fraction when the field is NOT being edited. (A
 * `type="number"` input also drops the trailing "." mid-entry, so this uses a decimal text input.)
 */
export function PercentInput({ value, onChange, label, ariaLabel }: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  label?: string;
  ariaLabel: string;
}) {
  const canonical = value === undefined ? "" : String(Math.round(value * 1000) / 10);
  const [buffer, setBuffer] = useState<string | null>(null);
  // If the parent changes `value` out from under an active buffer (e.g. a Reset that reverts the
  // field to its saved fraction), drop the stale buffer so the input reflects the new canonical
  // value instead of the text the user had typed before the reset.
  useEffect(() => {
    setBuffer((b) => (b !== null && Number(b) / 100 !== value ? null : b));
  }, [value]);
  return (
    <label className="flex items-center gap-1 text-xs">
      {label && <span className="text-muted-foreground">{label}</span>}
      <Input
        type="text" inputMode="decimal"
        aria-label={ariaLabel}
        className="w-20 rounded-none border-2 border-foreground tabular-nums"
        value={buffer ?? canonical}
        onFocus={() => setBuffer(canonical)}
        onBlur={() => setBuffer(null)}
        onChange={(e) => {
          const raw = e.target.value;
          // Only digits + a single decimal point while typing (keeps "7." valid mid-entry).
          if (!/^\d*\.?\d*$/.test(raw)) return;
          const trimmed = raw.trim();
          if (trimmed === "" || trimmed === ".") {
            // Cleared: drop the buffer so the field reflects the canonical value (e.g. a non-optional
            // field the parent resets to 0), rather than holding an empty string until blur.
            setBuffer(null);
            onChange(undefined);
            return;
          }
          setBuffer(raw); // keep the raw text (incl. a trailing ".") while mid-entry
          const n = Number(trimmed);
          if (isFinite(n) && n >= 0) onChange(n / 100);
        }}
      />
      <span className="text-muted-foreground">%</span>
    </label>
  );
}
