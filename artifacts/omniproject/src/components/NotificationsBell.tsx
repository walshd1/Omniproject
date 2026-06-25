import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useListNotifications, getListNotificationsQueryKey, type Notification } from "@workspace/api-client-react";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

const LIVE_PREF = "omni.notify.live";

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<boolean>(() => localStorage.getItem(LIVE_PREF) !== "off");
  const [connected, setConnected] = useState(false);
  // Notifications pushed over SSE (newest first), merged ahead of the polled list.
  const [pushed, setPushed] = useState<Notification[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const { data } = useListNotifications({
    // Poll less often when the live channel is on; it's the fallback.
    query: { queryKey: getListNotificationsQueryKey(), refetchInterval: live ? 300_000 : 60_000, retry: false },
  });

  useEffect(() => {
    localStorage.setItem(LIVE_PREF, live ? "on" : "off");
    if (!live) {
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
      return;
    }
    const es = new EventSource("/api/notifications/stream", { withCredentials: true });
    esRef.current = es;
    es.addEventListener("ready", () => setConnected(true));
    es.addEventListener("notification", (e) => {
      try {
        const n = JSON.parse((e as MessageEvent).data) as Notification;
        setPushed((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev].slice(0, 50)));
      } catch {
        /* ignore malformed event */
      }
    });
    es.onerror = () => setConnected(false);
    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [live]);

  // Merge live + polled, de-duped by id (live wins).
  const polled: Notification[] = data ?? [];
  const seen = new Set(pushed.map((n) => n.id));
  const items: Notification[] = [...pushed, ...polled.filter((n) => !seen.has(n.id))];
  const unread = items.filter((n) => !n.read).length;

  const latest = pushed[0];

  return (
    <div className="relative">
      {/* Announce live (SSE) notifications to assistive tech. */}
      <div aria-live="polite" className="sr-only">
        {latest ? `New notification: ${latest.title}` : ""}
      </div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative text-muted-foreground hover:text-foreground"
        title={live && connected ? "Notifications — live" : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 flex items-center justify-center text-[9px] font-black bg-red-500 text-white rounded-full">
            {unread}
          </span>
        )}
        {live && connected && unread === 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-green-500" title="Live" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="dialog" aria-label="Notifications" className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-card border border-border shadow-lg z-50">
            <div className="p-3 border-b border-border font-black uppercase tracking-widest text-xs flex items-center justify-between">
              <span>Notifications</span>
              <button
                onClick={() => setLive((v) => !v)}
                className="flex items-center gap-1.5 text-[10px] font-bold"
                title="Toggle real-time updates"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${live && connected ? "bg-green-500" : live ? "bg-amber-500 animate-pulse" : "bg-muted-foreground/40"}`} />
                {live ? (connected ? "LIVE" : "CONNECTING") : "LIVE OFF"}
              </button>
            </div>
            {items.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Nothing new.</div>
            ) : (
              items.map((n) => (
                <div key={n.id} className={`p-3 border-b border-border ${n.read ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold leading-tight">{n.title}</span>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">{timeAgo(n.timestamp)}</span>
                  </div>
                  {n.body && <p className="text-xs text-muted-foreground mt-1">{n.body}</p>}
                  <span className="inline-block mt-1 text-[9px] uppercase tracking-widest text-muted-foreground border border-border px-1">{n.kind}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
