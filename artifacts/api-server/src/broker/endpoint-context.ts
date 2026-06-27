import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-call broker endpoint override. Because every connected broker platform speaks
 * the SAME HTTP contract, dispatching a command to a specific KIND is just pointing
 * the (one) HTTP adapter at that kind's endpoint for the duration of the call. This
 * AsyncLocalStorage carries that endpoint down to `webhookPool()` — the single place
 * the adapter resolves its targets — so no adapter method has to be threaded with it,
 * and concurrent requests never bleed endpoints into each other.
 */
export interface EndpointScope {
  endpoints: string[];
}

const endpointContext = new AsyncLocalStorage<EndpointScope>();

/** The endpoints in scope for the current async call, if a kind was routed to. */
export function currentEndpointOverride(): string[] | undefined {
  const s = endpointContext.getStore();
  return s && s.endpoints.length ? s.endpoints : undefined;
}

/** Run `fn` with the broker adapter bound to `endpoints` (the routed kind's URL[s]). */
export function withEndpoints<T>(endpoints: string[], fn: () => T): T {
  return endpointContext.run({ endpoints }, fn);
}
