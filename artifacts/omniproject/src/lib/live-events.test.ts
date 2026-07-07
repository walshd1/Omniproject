import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { matchesLive, subscribeLiveEvents, useLiveEvents, type LiveEvent } from "./live-events";

/**
 * matchesLive decides whether a live event should revalidate a panel.
 */
describe("matchesLive", () => {
  it("any change revalidates when no kinds are specified", () => {
    expect(matchesLive({ kind: "deadline" })).toBe(true);
    expect(matchesLive({})).toBe(true);
    expect(matchesLive({ kind: "x" }, [])).toBe(true);
  });

  it("restricts to the listed kinds when liveOn is given", () => {
    expect(matchesLive({ kind: "deadline" }, ["deadline", "assignment"])).toBe(true);
    expect(matchesLive({ kind: "critical" }, ["deadline"])).toBe(false);
    expect(matchesLive({}, ["deadline"])).toBe(false); // no kind ⇒ no match when filtered
  });
});

/**
 * Fake EventSource so the shared-connection logic (normally a no-op in jsdom, which has no
 * EventSource) can be exercised: one connection per process, shared across subscribers, closed
 * only once the last one leaves.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  closed = false;
  private listeners: Record<string, Array<(ev: { data: string }) => void>> = {};

  constructor(url: string, opts?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = !!opts?.withCredentials;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (ev: { data: string }) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }

  close(): void {
    this.closed = true;
  }

  /** Deliver a well-formed notification payload to every registered listener. */
  emit(type: string, data: unknown): void {
    for (const cb of this.listeners[type] ?? []) cb({ data: JSON.stringify(data) });
  }

  /** Deliver a raw (possibly malformed) payload string, bypassing JSON.stringify. */
  emitRaw(type: string, raw: string): void {
    for (const cb of this.listeners[type] ?? []) cb({ data: raw });
  }
}

describe("shared live-event connection", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is a no-op where EventSource is unavailable (SSR/tests)", () => {
    vi.stubGlobal("EventSource", undefined);
    const handler = vi.fn();
    const unsubscribe = subscribeLiveEvents(handler);
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(() => unsubscribe()).not.toThrow();
  });

  it("opens exactly one connection for multiple subscribers, and closes it only once the last leaves", () => {
    const unsubscribe1 = subscribeLiveEvents(vi.fn());
    const unsubscribe2 = subscribeLiveEvents(vi.fn());
    expect(FakeEventSource.instances).toHaveLength(1);
    const instance = FakeEventSource.instances[0]!;
    expect(instance.url).toBe("/api/notifications/stream");
    expect(instance.withCredentials).toBe(true);

    unsubscribe1();
    expect(instance.closed).toBe(false); // one subscriber remains

    unsubscribe2();
    expect(instance.closed).toBe(true); // last subscriber ⇒ connection closes
  });

  it("forwards a parsed notification event to every subscribed handler", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const unsubscribeA = subscribeLiveEvents(handlerA);
    const unsubscribeB = subscribeLiveEvents(handlerB);
    const instance = FakeEventSource.instances[0]!;

    instance.emit("notification", { kind: "deadline", issueId: "i1" });
    expect(handlerA).toHaveBeenCalledWith({ kind: "deadline", issueId: "i1" });
    expect(handlerB).toHaveBeenCalledWith({ kind: "deadline", issueId: "i1" });

    unsubscribeA();
    unsubscribeB();
  });

  it("swallows a malformed JSON payload instead of throwing, delivering an empty event", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeLiveEvents(handler);
    const instance = FakeEventSource.instances[0]!;

    expect(() => instance.emitRaw("notification", "{not json")).not.toThrow();
    expect(handler).toHaveBeenCalledWith({});

    unsubscribe();
  });

  it("re-opens a fresh connection after the previous one fully disconnected", () => {
    const unsubscribe1 = subscribeLiveEvents(vi.fn());
    unsubscribe1();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);

    const unsubscribe2 = subscribeLiveEvents(vi.fn());
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]!.closed).toBe(false);
    unsubscribe2();
  });
});

describe("useLiveEvents (hook form)", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("subscribes for the component's lifetime and unsubscribes (closing the connection) on unmount", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useLiveEvents(handler));
    const instance = FakeEventSource.instances[0]!;

    instance.emit("notification", { kind: "assignment" } satisfies LiveEvent);
    expect(handler).toHaveBeenCalledWith({ kind: "assignment" });

    unmount();
    expect(instance.closed).toBe(true);
  });

  it("always calls the latest handler without re-subscribing on rerender", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const { rerender, unmount } = renderHook(({ handler }) => useLiveEvents(handler), {
      initialProps: { handler: handlerA },
    });
    rerender({ handler: handlerB });
    expect(FakeEventSource.instances).toHaveLength(1); // no new connection on rerender

    const instance = FakeEventSource.instances[0]!;
    instance.emit("notification", { kind: "y" });
    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledWith({ kind: "y" });

    unmount();
  });
});
