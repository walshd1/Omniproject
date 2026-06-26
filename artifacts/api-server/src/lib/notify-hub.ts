/**
 * Real-time notification hub (Server-Sent Events).
 *
 * Keeps a set of *live connections* — not persisted application state, so
 * OmniProject stays stateless. n8n (or any tool) POSTs an event to
 * /api/notifications/ingest and the hub fans it out to matching connected
 * clients in real time; the in-app bell updates instantly.
 *
 * Multi-replica note: connections are per-process. For HA real-time, put a
 * pub/sub (e.g. Redis) in front of publish(), or use sticky sessions.
 */

export interface NotifyTarget {
  sub?: string;
  email?: string;
  role?: string;
}

export interface NotifyClient {
  id: string;
  sub?: string;
  email?: string;
  roles: string[];
  send: (event: string, data: unknown) => void;
  /** End the underlying SSE response — called on graceful shutdown. */
  close?: () => void;
}

const clients = new Set<NotifyClient>();

/** Does a target address this client? An empty/absent target is a broadcast. */
export function clientMatches(client: { sub?: string; email?: string; roles: string[] }, target?: NotifyTarget): boolean {
  if (!target || (!target.sub && !target.email && !target.role)) return true;
  if (target.sub && client.sub === target.sub) return true;
  if (target.email && client.email === target.email) return true;
  if (target.role && client.roles.includes(target.role)) return true;
  return false;
}

export function addClient(client: NotifyClient): () => void {
  clients.add(client);
  return () => clients.delete(client);
}

export function clientCount(): number {
  return clients.size;
}

/** Close every live SSE connection and forget them — used on graceful shutdown
 *  so the HTTP server can finish closing instead of being held open by streams. */
export function closeAllClients(): number {
  const n = clients.size;
  for (const c of clients) {
    try {
      c.close?.();
    } catch {
      /* the connection is already gone */
    }
  }
  clients.clear();
  return n;
}

/**
 * Fan a notification out to matching clients connected **to this process** and
 * return how many received it. The notify bus calls this on every replica; it is
 * not the public entry point — ingest goes through the bus (notify-bus.ts).
 */
export function deliverLocal(notification: unknown, target?: NotifyTarget): number {
  let delivered = 0;
  for (const c of clients) {
    if (clientMatches(c, target)) {
      c.send("notification", notification);
      delivered++;
    }
  }
  return delivered;
}
