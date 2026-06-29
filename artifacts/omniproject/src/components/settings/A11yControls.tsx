import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useA11yPrefs, A11Y_SCALE_BOUNDS, type SwitchScanMode, type MobileMode, type Density } from "../../lib/a11y-prefs";
import { isSpeechSupported } from "../../lib/speech";
import { usePlatform } from "../../lib/platform-context";

const SCAN_OPTIONS: { value: SwitchScanMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "single", label: "Single-switch (auto-scan)" },
  { value: "two", label: "Two-switch (step)" },
];

const MOBILE_OPTIONS: { value: MobileMode; label: string }[] = [
  { value: "auto", label: "Auto (follow device)" },
  { value: "on", label: "Always on" },
  { value: "off", label: "Always off" },
];

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

/**
 * Accessibility controls — a per-user overlay (text SIZE, background COLOUR, high
 * contrast, reduced motion, switch-access scanning, screen-reader narration and
 * voice dictation). Cached in this browser and persisted server-side per user, so a
 * person's setup follows them across sessions and devices on top of company branding.
 */
export function A11yControls() {
  const {
    prefs, setFontScale, setBackgroundColor, toggleHighContrast, toggleReduceMotion,
    setSwitchScan, setScanRate, toggleScreenReader, toggleSpeechInput, setMobileMode, setDensity, reset,
  } = useA11yPrefs();
  const pct = Math.round(prefs.fontScale * 100);
  const speechSupported = isSpeechSupported();
  const { isMobile, platform } = usePlatform();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accessibility</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="a11y-textsize">Text size</Label>
          <div className="flex items-center gap-2" id="a11y-textsize">
            <Button variant="outline" size="sm" aria-label="Decrease text size" disabled={prefs.fontScale <= A11Y_SCALE_BOUNDS.min} onClick={() => setFontScale(prefs.fontScale - 0.1)}>A−</Button>
            <span className="w-12 text-center text-sm tabular-nums" role="status" aria-live="polite">{pct}%</span>
            <Button variant="outline" size="sm" aria-label="Increase text size" disabled={prefs.fontScale >= A11Y_SCALE_BOUNDS.max} onClick={() => setFontScale(prefs.fontScale + 0.1)}>A+</Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="a11y-bg">Background colour</Label>
          <div className="flex items-center gap-2">
            <input
              id="a11y-bg"
              type="color"
              aria-label="Background colour"
              value={prefs.backgroundColor ?? "#f2f3f5"}
              onChange={(e) => setBackgroundColor(e.target.value)}
              className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
            />
            {prefs.backgroundColor && (
              <Button variant="ghost" size="sm" onClick={() => setBackgroundColor(null)} aria-label="Clear background colour">Clear</Button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="a11y-contrast">High contrast</Label>
          <Switch id="a11y-contrast" checked={prefs.highContrast} onCheckedChange={toggleHighContrast} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="a11y-motion">Reduce motion</Label>
          <Switch id="a11y-motion" checked={prefs.reduceMotion} onCheckedChange={toggleReduceMotion} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label id="a11y-density-label">Density</Label>
          <div className="inline-flex border border-border" role="group" aria-labelledby="a11y-density-label">
            {DENSITY_OPTIONS.map((o) => (
              <Button
                key={o.value}
                variant={prefs.density === o.value ? "default" : "outline"}
                size="sm"
                aria-pressed={prefs.density === o.value}
                onClick={() => setDensity(o.value)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="a11y-scan">Switch-access scanning</Label>
            <select
              id="a11y-scan"
              value={prefs.switchScan}
              onChange={(e) => setSwitchScan(e.target.value as SwitchScanMode)}
              className="h-9 rounded-md border border-border bg-transparent px-2 text-sm"
            >
              {SCAN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {prefs.switchScan === "single" && (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="a11y-scanrate">Scan speed</Label>
              <div className="flex items-center gap-2">
                <input
                  id="a11y-scanrate"
                  type="range"
                  min={500}
                  max={5000}
                  step={250}
                  value={prefs.scanRateMs}
                  onChange={(e) => setScanRate(Number(e.target.value))}
                  aria-label="Auto-scan dwell time"
                />
                <span className="w-14 text-right text-sm tabular-nums">{(prefs.scanRateMs / 1000).toFixed(2)}s</span>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Single-switch sweeps automatically — press Space or Enter to choose. Two-switch
            steps on Space (or →/↓) and chooses on Enter.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <Label htmlFor="a11y-reader">Screen-reader narration</Label>
          <Switch id="a11y-reader" checked={prefs.screenReader} onCheckedChange={toggleScreenReader} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="a11y-speech">Voice dictation</Label>
            {!speechSupported && <p className="text-xs text-muted-foreground">Not available in this browser.</p>}
          </div>
          <Switch id="a11y-speech" checked={prefs.speechInput} disabled={!speechSupported} onCheckedChange={toggleSpeechInput} />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <div>
            <Label htmlFor="a11y-mobile">Mobile layout</Label>
            <p className="text-xs text-muted-foreground">
              Currently {isMobile ? "on" : "off"} ({platform.formFactor}).
            </p>
          </div>
          <select
            id="a11y-mobile"
            value={prefs.mobileMode}
            onChange={(e) => setMobileMode(e.target.value as MobileMode)}
            className="h-9 rounded-md border border-border bg-transparent px-2 text-sm"
          >
            {MOBILE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="flex justify-end border-t border-border pt-4">
          <Button variant="ghost" size="sm" onClick={reset}>Reset to company default</Button>
        </div>
        <p className="text-xs text-muted-foreground">Saved to your account so it follows you across devices — it never changes the company theme.</p>
      </CardContent>
    </Card>
  );
}
