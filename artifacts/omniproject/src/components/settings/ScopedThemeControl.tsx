import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Palette } from "lucide-react";
import { useScopedTheme, hasScopedStyle } from "../../lib/theme-scope";
import { type FontChoice } from "../../lib/artifact-style";
import type { ScopedOverride } from "../../lib/a11y-prefs";

/**
 * The per-screen / per-artifact theme control (Mode 2). Edits apply to the SESSION immediately (the
 * default "one-off"); "Save to profile" promotes them to the user's saved profile so they persist
 * across devices. Clearing the last field resets the surface back to the global look.
 */
const FONTS: { value: FontChoice | ""; label: string }[] = [
  { value: "", label: "Inherit" },
  { value: "sans", label: "Sans-serif" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Monospace" },
];

export function ScopedThemeControl({ scopeId, label, className = "" }: { scopeId: string; label: string; className?: string }) {
  const { effective, savedActive, sessionActive, setSessionOverride, saveToProfile, clear } = useScopedTheme(scopeId);
  const o: ScopedOverride = effective ?? {};
  const active = savedActive || sessionActive;

  // Apply a field change to the session; clearing the LAST field resets the surface entirely
  // (removes the saved override too), so "no fields" always means "back to the global look".
  const update = (patch: Partial<ScopedOverride>): void => {
    const next: ScopedOverride = { ...o, ...patch };
    if (hasScopedStyle(next)) setSessionOverride(next);
    else clear();
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Theme for ${label}`}
          title={`Theme for ${label}`}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-border ${active ? "bg-primary/10 text-primary" : "text-muted-foreground"} ${className}`}
        >
          <Palette className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div>
          <div className="text-sm font-bold">Theme · {label}</div>
          <p className="text-xs text-muted-foreground">
            {sessionActive && !savedActive
              ? "This session only — save it to keep it."
              : savedActive
                ? "Saved to your profile."
                : "Inherits your global settings."}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`scope-font-${scopeId}`}>Font</Label>
          <select
            id={`scope-font-${scopeId}`}
            value={o.fontFamily ?? ""}
            onChange={(e) => update({ fontFamily: e.target.value === "" ? null : (e.target.value as FontChoice) })}
            className="h-9 rounded-md border border-border bg-transparent px-2 text-sm"
          >
            {FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`scope-accent-${scopeId}`}>Accent colour</Label>
          <div className="flex items-center gap-2">
            <input
              id={`scope-accent-${scopeId}`}
              type="color"
              aria-label="Accent colour"
              value={o.accentColor ?? "#2563eb"}
              onChange={(e) => update({ accentColor: e.target.value })}
              className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
            />
            {o.accentColor && <Button variant="ghost" size="sm" onClick={() => update({ accentColor: null })} aria-label="Clear accent colour">Clear</Button>}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`scope-bg-${scopeId}`}>Background</Label>
          <div className="flex items-center gap-2">
            <input
              id={`scope-bg-${scopeId}`}
              type="color"
              aria-label="Background colour"
              value={o.backgroundColor ?? "#f2f3f5"}
              onChange={(e) => update({ backgroundColor: e.target.value })}
              className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
            />
            {o.backgroundColor && <Button variant="ghost" size="sm" onClick={() => update({ backgroundColor: null })} aria-label="Clear background colour">Clear</Button>}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={clear} disabled={!active}>Reset</Button>
          <Button size="sm" onClick={saveToProfile} disabled={!sessionActive}>Save to profile</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
