import { useState } from "react";
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

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const { data } = useListNotifications({
    query: { queryKey: getListNotificationsQueryKey(), refetchInterval: 60_000, retry: false },
  });
  const items: Notification[] = data ?? [];
  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative text-muted-foreground hover:text-foreground"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 flex items-center justify-center text-[9px] font-black bg-red-500 text-white rounded-full">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-card border border-border shadow-lg z-50">
            <div className="p-3 border-b border-border font-black uppercase tracking-widest text-xs flex items-center justify-between">
              <span>Notifications</span>
              <span className="text-muted-foreground">{unread} unread</span>
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
