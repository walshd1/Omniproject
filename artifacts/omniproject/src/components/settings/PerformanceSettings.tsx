import { AlertTriangle, ShieldCheck, Bell } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useFeatures, featureEnabled } from "../../lib/features";
import { usePredictivePrefetchSetting } from "../../lib/prefetch";
import { useOfflineCacheSetting } from "../../lib/use-offline-cache";
import { usePushNotifications } from "../../lib/use-push";

/**
 * Performance settings. Deterministic prefetch-on-intent (hover/focus) is always on and needs no
 * control. This card governs the heavier PREDICTIVE (speculative) tier: a per-user, off-by-default
 * toggle, shown only when the `predictivePrefetch` feature module is enabled (an operator can hide
 * it org-wide), and carrying a prominent health warning because it multiplies real broker calls.
 */
export function PerformanceSettings() {
  const { data: features } = useFeatures();
  const enabled = usePredictivePrefetchSetting((s) => s.enabled);
  const setEnabled = usePredictivePrefetchSetting((s) => s.setEnabled);
  const offlineEnabled = useOfflineCacheSetting((s) => s.enabled);
  const setOfflineEnabled = useOfflineCacheSetting((s) => s.setEnabled);

  const push = usePushNotifications();

  const predictiveOn = featureEnabled(features, "predictivePrefetch");
  const offlineOn = featureEnabled(features, "offlineCache");
  if (!predictiveOn && !offlineOn && !push.available) return null;

  return (
    <div className="space-y-4">
      {push.available && (
        <Card data-testid="push-settings">
          <CardHeader><CardTitle>Notifications on this device</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="push-notifications">Send me push notifications</Label>
                <p className="text-xs text-muted-foreground">
                  Get alerts on this device — approvals, mentions, incidents — even when OmniProject is closed.
                </p>
              </div>
              <Switch
                id="push-notifications"
                data-testid="push-toggle"
                checked={push.state === "on"}
                disabled={push.state === "busy" || push.state === "denied"}
                onCheckedChange={push.toggle}
                aria-describedby="push-note"
              />
            </div>
            <div id="push-note" role="note" className="flex gap-3 border border-border bg-muted/40 p-3 text-xs text-foreground">
              <Bell className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="space-y-1">
                {push.state === "denied" ? (
                  <p><strong>Notifications are blocked</strong> for OmniProject in this browser. Re-enable them in your browser's site settings, then turn this on.</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-4">
                    <li>Only <strong>your own</strong> notifications are delivered — this device, encrypted in transit by the push service.</li>
                    <li>Registered per browser and <strong>off by default</strong>; turn it off any time and this device stops receiving them.</li>
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {offlineOn && (
        <Card data-testid="offline-cache-settings">
          <CardHeader><CardTitle>Offline access</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="offline-cache">Keep my work available offline</Label>
                <p className="text-xs text-muted-foreground">
                  Cache your <strong>My Work &amp; Tasks</strong> on this device so they open when you're offline.
                </p>
              </div>
              <Switch id="offline-cache" data-testid="offline-cache-toggle" checked={offlineEnabled} onCheckedChange={setOfflineEnabled} aria-describedby="offline-cache-note" />
            </div>
            <div id="offline-cache-note" role="note" className="flex gap-3 border border-border bg-muted/40 p-3 text-xs text-foreground">
              <ShieldCheck className="h-4 w-4 shrink-0 text-green-600 dark:text-green-500" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-bold uppercase tracking-widest">Encrypted &amp; ephemeral</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>Only your <strong>My Work / Tasks</strong> read models are cached — never other projects, financials, AI, or writes.</li>
                  <li><strong>Encrypted at rest</strong> with a key that never leaves this browser, and <strong>wiped on logout</strong> (and when you turn this off).</li>
                  <li>Stale entries expire automatically; it's off by default and local to this device.</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {predictiveOn && (
    <Card>
      <CardHeader>
        <CardTitle>Performance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Prefetch-on-hover is always on — opening something you point at feels instant. The toggle
          below enables an extra, <em>speculative</em> tier on top of that.
        </p>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="perf-predictive">Predictive loading (preview)</Label>
            <p className="text-xs text-muted-foreground">
              Warm data before you ask for it — e.g. every project listed on a page, not just the one you hover.
            </p>
          </div>
          <Switch
            id="perf-predictive"
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-describedby="perf-predictive-warning"
          />
        </div>

        <div
          id="perf-predictive-warning"
          role="note"
          data-testid="predictive-prefetch-warning"
          className="flex gap-3 border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-foreground"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden="true" />
          <div className="space-y-2">
            <p className="font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
              Health warning — read before enabling
            </p>
            <p>
              OmniProject is a stateless overlay: every prefetch is a <strong>real call to your backend</strong>
              {" "}(Jira, OpenProject, …). Predictive loading warms data you might never open, trading speed for
              extra load you don't fully control.
            </p>
            <ul className="list-disc space-y-1 pl-4">
              <li><strong>Rate limits:</strong> speculative fetches count against the per-user API limit, so they can make your <em>real</em> requests hit 429s.</li>
              <li><strong>Backend load &amp; cost:</strong> many more requests reach your system of record; on metered or fragile backends that has a real price.</li>
              <li><strong>Scope is conservative:</strong> it only warms read-model data you can already see — never AI, never a write, never a gated action.</li>
              <li><strong>Local + reversible:</strong> the setting lives in this browser only and is off by default; turn it off any time and speculative loading stops at once (hover prefetch stays).</li>
            </ul>
            <p>Leave this off unless your backend comfortably absorbs the extra read traffic.</p>
          </div>
        </div>
      </CardContent>
    </Card>
      )}
    </div>
  );
}
