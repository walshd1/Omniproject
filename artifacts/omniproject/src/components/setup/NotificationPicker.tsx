import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { fetchNotificationChannels } from "../../lib/setup";
import { Dot, PickerGrid, TechDetails } from "./shared";

const KIND_LABELS: Record<string, string> = {
  chat: "A team chat channel",
  email: "An email inbox",
  incident: "An on-call/incident tool",
  sms: "A text message",
  webhook: "A generic webhook",
  iot: "A device/IoT bus",
  agent: "An AI agent tool surface",
};

/**
 * Browse where OmniProject can push alerts/events TO (Slack, Teams, PagerDuty, email, …) —
 * the same non-technical tile picker as the backend/broker/output pickers, so choosing a
 * notification destination doesn't require knowing delivery mechanics up front. Purely
 * informational here: which channel an event kind actually dispatches to is a JSON routing
 * rule (below the seam), not a per-tile switch.
 */
export function NotificationPicker() {
  const { data: channels = [] } = useQuery({
    queryKey: ["setup-notifications"],
    queryFn: fetchNotificationChannels,
    staleTime: 60_000,
  });
  const [channelId, setChannelId] = useState("");
  const selected = channels.find((c) => c.id === channelId);

  if (channels.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
        Where can OmniProject send alerts?
      </p>
      <PickerGrid
        items={channels}
        getKey={(c) => c.id}
        isSelected={(c) => c.id === channelId}
        onSelect={(c) => setChannelId((id) => (id === c.id ? "" : c.id))}
        ariaLabel="Browse notification channels"
        renderTile={(c) => (
          <>
            <div className="font-black uppercase tracking-wider flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {c.label}
            </div>
            <div className="text-muted-foreground mt-1">{KIND_LABELS[c.kind] ?? c.kind}</div>
          </>
        )}
      />
      {selected && (
        <TechDetails label={`Technical details for ${selected.label}`}>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5"><Dot on={selected.capabilities.channels} /> shared channels</span>
            <span className="flex items-center gap-1.5"><Dot on={selected.capabilities.directMessage} /> direct message</span>
            <span className="flex items-center gap-1.5"><Dot on={selected.capabilities.richFormatting} /> rich formatting</span>
            <span className="flex items-center gap-1.5"><Dot on={selected.capabilities.threads} /> threads</span>
            <span className="flex items-center gap-1.5"><Dot on={selected.capabilities.inboundReply} /> inbound reply</span>
            <span className="text-muted-foreground">wired via: <span className="font-mono">{selected.capabilities.delivery}</span></span>
          </div>
          {selected.notes && <p className="text-muted-foreground">{selected.notes}</p>}
        </TechDetails>
      )}
    </div>
  );
}
