import { Input } from "@/components/ui/input";

/**
 * A percentage <input> bound to a 0–1 fraction (so 20 ↔ 0.2). Shared by the rate-card / cost-rule
 * editors. Empty ⇒ `undefined`, for optional margin/overhead fields that fall back to a default.
 */
export function PercentInput({ value, onChange, label, ariaLabel }: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  label?: string;
  ariaLabel: string;
}) {
  return (
    <label className="flex items-center gap-1 text-xs">
      {label && <span className="text-muted-foreground">{label}</span>}
      <Input
        type="number" min={0} step={1} inputMode="decimal"
        aria-label={ariaLabel}
        className="w-20 rounded-none border-2 border-foreground tabular-nums"
        value={value === undefined ? "" : Math.round(value * 1000) / 10}
        onChange={(e) => {
          const t = e.target.value.trim();
          if (t === "") { onChange(undefined); return; }
          const n = Number(t);
          if (isFinite(n) && n >= 0) onChange(n / 100);
        }}
      />
      <span className="text-muted-foreground">%</span>
    </label>
  );
}
