import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useA11yPrefs } from "../../lib/a11y-prefs";
import { notificationKindCatalogue, type NotifyChannel } from "@workspace/backend-catalogue";

/**
 * Per-user NOTIFICATION preferences — which channels to receive on, which event kinds to silence, and a
 * daily quiet-hours window. Rides the same per-user prefs blob (and /me/prefs sync) as the accessibility
 * controls, so a person's choices follow them across devices. A `critical` kind (blocker, incident) can
 * never be muted — the server always delivers it to the in-app bell — so its mute toggle is disabled.
 */

const CHANNELS: { id: NotifyChannel; label: string; hint: string }[] = [
  { id: "inApp", label: "In-app bell", hint: "The live notification bell in the app." },
  { id: "email", label: "Email", hint: "Digests + direct emails." },
  { id: "push", label: "Push", hint: "Browser / device push notifications." },
];

export function NotificationPreferences() {
  const { prefs, setNotifications } = useA11yPrefs();
  const n = prefs.notifications;

  const setChannel = (id: NotifyChannel, on: boolean) =>
    setNotifications({ ...n, channels: { ...n.channels, [id]: on } });

  const toggleMuted = (kind: string, muted: boolean) =>
    setNotifications({ ...n, mutedKinds: muted ? [...new Set([...n.mutedKinds, kind])] : n.mutedKinds.filter((k) => k !== kind) });

  const setQuiet = (patch: Partial<typeof n.quietHours>) =>
    setNotifications({ ...n, quietHours: { ...n.quietHours, ...patch } });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Channels */}
        <fieldset className="space-y-3">
          <legend className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">Channels</legend>
          {CHANNELS.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-4">
              <Label htmlFor={`notify-ch-${c.id}`} className="flex flex-col">
                <span>{c.label}</span>
                <span className="text-[11px] text-muted-foreground font-normal">{c.hint}</span>
              </Label>
              <Switch id={`notify-ch-${c.id}`} checked={n.channels[c.id]} onCheckedChange={(v) => setChannel(c.id, v)} />
            </div>
          ))}
        </fieldset>

        {/* Quiet hours */}
        <fieldset className="space-y-3 border-t border-border pt-4">
          <legend className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">Quiet hours</legend>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="notify-quiet" className="flex flex-col">
              <span>Mute email &amp; push overnight</span>
              <span className="text-[11px] text-muted-foreground font-normal">The in-app bell still records; emergencies always come through.</span>
            </Label>
            <Switch id="notify-quiet" checked={n.quietHours.enabled} onCheckedChange={(v) => setQuiet({ enabled: v })} />
          </div>
          {n.quietHours.enabled && (
            <div className="flex items-center gap-3 text-sm">
              <Label htmlFor="notify-quiet-start">From</Label>
              <input
                id="notify-quiet-start"
                type="time"
                value={n.quietHours.start}
                onChange={(e) => setQuiet({ start: e.target.value })}
                className="border border-border bg-background px-2 py-1 rounded-none"
              />
              <Label htmlFor="notify-quiet-end">to</Label>
              <input
                id="notify-quiet-end"
                type="time"
                value={n.quietHours.end}
                onChange={(e) => setQuiet({ end: e.target.value })}
                className="border border-border bg-background px-2 py-1 rounded-none"
              />
            </div>
          )}
        </fieldset>

        {/* Per-kind mute */}
        <fieldset className="space-y-2 border-t border-border pt-4">
          <legend className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">Event types</legend>
          <p className="text-[11px] text-muted-foreground">Turn a type off to stop being notified about it. Critical alerts can’t be muted.</p>
          {notificationKindCatalogue().map((k) => {
            const critical = k.severity === "critical";
            const muted = n.mutedKinds.includes(k.id);
            return (
              <div key={k.id} className="flex items-center justify-between gap-4">
                <Label htmlFor={`notify-kind-${k.id}`} className="flex items-center gap-2">
                  <span>{k.label}</span>
                  {critical && <span className="text-[10px] font-black uppercase tracking-wider text-destructive">critical</span>}
                </Label>
                {/* On = notified; off = muted. Critical is always on + locked. */}
                <Switch
                  id={`notify-kind-${k.id}`}
                  checked={critical ? true : !muted}
                  disabled={critical}
                  onCheckedChange={(v) => toggleMuted(k.id, !v)}
                />
              </div>
            );
          })}
        </fieldset>
      </CardContent>
    </Card>
  );
}
