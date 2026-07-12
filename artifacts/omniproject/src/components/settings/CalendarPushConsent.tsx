import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { getJson, sendJson } from "../../lib/api";

interface CalendarPushGrant {
  granted: boolean;
  target: "google-calendar" | "outlook-calendar" | null;
  scope: "mine" | "all";
  grantedAt: string | null;
}

const TARGETS: { value: NonNullable<CalendarPushGrant["target"]>; label: string }[] = [
  { value: "google-calendar", label: "Google Calendar" },
  { value: "outlook-calendar", label: "Outlook Calendar" },
];

/**
 * Per-user calendar-push CONSENT. Nothing is ever pushed to a calendar unless the user turns this on
 * and picks a destination — the gateway stores only this permission, never a calendar credential; the
 * calendar connection the user authorises does the actual writing, and revoking here stops it.
 */
export function CalendarPushConsent() {
  const qc = useQueryClient();
  const { data: grant } = useQuery({ queryKey: ["calendar-push"], queryFn: () => getJson<CalendarPushGrant>("/api/calendar/push") });
  const save = useMutation({
    mutationFn: (patch: Partial<CalendarPushGrant>) => sendJson("/api/calendar/push", { ...grant, ...patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar-push"] }),
  });
  const g = grant ?? { granted: false, target: null, scope: "mine" as const, grantedAt: null };

  return (
    <Card className="rounded-none border-border">
      <CardHeader>
        <CardTitle className="text-sm font-bold uppercase tracking-wider">Push my schedule to a calendar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Off by default. Left off, you still add items to your calendar case-by-case yourself (the
          Export menu, or "add this" on an item). Turn it on to give an ongoing, standing permission for
          the calendar connection you authorise to keep your schedule in sync — OmniProject never stores
          your calendar credentials, and revoking here stops it.
        </p>
        <div className="flex items-center justify-between">
          <Label htmlFor="cal-push" className="text-sm">Enable calendar push</Label>
          <Switch
            id="cal-push"
            checked={g.granted}
            onCheckedChange={(on) => save.mutate({ granted: on, target: on ? g.target ?? "google-calendar" : g.target })}
          />
        </div>
        {g.granted && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Destination</Label>
              <select
                className="w-full rounded-none border border-border bg-card px-2 py-2 text-sm font-mono"
                value={g.target ?? "google-calendar"}
                onChange={(e) => save.mutate({ target: e.target.value as CalendarPushGrant["target"] })}
              >
                {TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Which items</Label>
              <select
                className="w-full rounded-none border border-border bg-card px-2 py-2 text-sm font-mono"
                value={g.scope}
                onChange={(e) => save.mutate({ scope: e.target.value as CalendarPushGrant["scope"] })}
              >
                <option value="mine">My tasks &amp; deadlines</option>
                <option value="all">Everything in my scope</option>
              </select>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
