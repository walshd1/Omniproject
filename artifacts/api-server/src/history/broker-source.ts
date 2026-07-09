/**
 * `BrokerRetentionSource` — the gateway's no-SDK bridge to the retention-broker service. It implements
 * the `RetentionSource` contract by calling the broker over HTTP; the broker (a separate process, in
 * `services/retention-broker`) is where the cloud SDKs actually run. This keeps the gateway
 * zero-at-rest and SDK-free (the `guard-zero-at-rest-above-seam` guard stays green) while still giving
 * it durable history: the process boundary, not just a package boundary, keeps persistence below the
 * seam. See docs/RETENTION-CONNECTORS.md.
 */
import type { EntitySnapshot, HistoryEntry, TimeWindow } from "./types";
import type { RetentionSource, RetentionScope, RetentionProvider } from "./retention";
import { registerRetentionProvider } from "./retention";

export interface BrokerRetentionOptions {
  /** Base URL of the retention-broker service (e.g. http://retention-broker:8090). */
  baseUrl: string;
  /** Optional bearer token; sent as `Authorization: Bearer <token>` when set. */
  token?: string;
  /** Injectable fetch (defaults to global fetch) — tests pass a fake. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms (default 10s). */
  timeoutMs?: number;
}

/** POST one retention op to the broker and parse its JSON reply. */
async function call<T>(opts: BrokerRetentionOptions, op: string, body: unknown): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await doFetch(`${opts.baseUrl.replace(/\/$/, "")}/retention/${op}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`retention-broker ${op} failed: ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** A `RetentionSource` backed by the retention-broker HTTP service (no cloud SDK in this process). */
export function brokerRetentionSource(opts: BrokerRetentionOptions): RetentionSource {
  return {
    readSnapshots: (entity, ids, window: TimeWindow) =>
      call<EntitySnapshot[]>(opts, "read-snapshots", { entity, ids, window }),
    readJournal: (entity, id, window: TimeWindow) =>
      call<HistoryEntry[]>(opts, "read-journal", { entity, id, window }),
    appendJournal: (entries) => call<void>(opts, "append-journal", { entries }),
    writeSnapshot: (snapshot) => call<void>(opts, "write-snapshot", { snapshot }),
    lastSnapshotAt: (entity, id) =>
      call<{ asOf: string | null }>(opts, "last-snapshot-at", { entity, id }).then((r) => r.asOf),
  };
}

/**
 * Register the broker retention provider from the environment. When `RETENTION_BROKER_URL` is set,
 * every scope resolves to a `brokerRetentionSource` pointing at it (the broker itself applies any
 * scope routing). A no-op when unset — the trend API then answers the honest "history not yet
 * retained". Call once at boot.
 */
export function registerBrokerRetentionFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const baseUrl = env["RETENTION_BROKER_URL"]?.trim();
  if (!baseUrl) return false;
  const token = env["RETENTION_BROKER_TOKEN"]?.trim();
  const source = brokerRetentionSource({ baseUrl, ...(token ? { token } : {}) });
  const provider: RetentionProvider = (_scope: RetentionScope) => source;
  registerRetentionProvider(provider);
  return true;
}
