import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useA11yPrefs, A11Y_SCALE_BOUNDS } from "../../lib/a11y-prefs";

/**
 * Accessibility controls — a per-user overlay (text size, high contrast, reduced
 * motion) stored only in this browser. It sits on top of the company branding and
 * never touches the server, so each person can make the shared theme work for them.
 */
export function A11yControls() {
  const { prefs, setFontScale, toggleHighContrast, toggleReduceMotion, reset } = useA11yPrefs();
  const pct = Math.round(prefs.fontScale * 100);
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
          <Label htmlFor="a11y-contrast">High contrast</Label>
          <Switch id="a11y-contrast" checked={prefs.highContrast} onCheckedChange={toggleHighContrast} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="a11y-motion">Reduce motion</Label>
          <Switch id="a11y-motion" checked={prefs.reduceMotion} onCheckedChange={toggleReduceMotion} />
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={reset}>Reset to company default</Button>
        </div>
        <p className="text-xs text-muted-foreground">Saved only in this browser — it never changes the company theme or the server.</p>
      </CardContent>
    </Card>
  );
}
