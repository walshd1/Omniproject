import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { peerInitials, freshPeers, usePresence, LOCK_TTL_MS, type PresencePeer } from "./presence";

/**
 * Presence client — pure helpers + the room hook (SSE in, advisory editing claim out). Ephemeral.
 */

describe("peerInitials", () => {
  it("takes the first two words' initials", () => {
    expect(peerInitials("Ada Lovelace")).toBe("AL");
  });
  it("falls back to the first two characters of a single word", () => {
    expect(peerInitials("ada")).toBe("AD");
  });
  it("handles an empty label", () => {
    expect(peerInitials("   ")).toBe("?");
  });
});

describe("freshPeers", () => {
  const peer = (over: Partial<PresencePeer> = {}): PresencePeer =>
    ({ cid: "c1", sub: "u1", label: "Ada", color: "#000", editing: "status", editingAt: 1000, ...over });

  it("keeps a fresh editing claim", () => {
    expect(freshPeers([peer()], 1000 + LOCK_TTL_MS - 1)[0]!.editing).toBe("status");
  });
  it("expires a stale editing claim", () => {
    expect(freshPeers([peer()], 1000 + LOCK_TTL_MS)[0]!.editing).toBeNull();
  });
});

// ── Hook test with a minimal mock EventSource ──────────────────────────────────────────────────
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, ((ev: MessageEvent) => void)[]> = {};
  closed = false;
  constructor(url: string) { this.url = url; MockEventSource.instances.push(this); }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) { (this.listeners[type] ??= []).push(fn); }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) } as MessageEvent);
  }
  close() { this.closed = true; }
}

function Harness({ roomId, enabled }: { roomId: string | null; enabled: boolean }) {
  const { peers, setEditing } = usePresence(roomId, enabled);
  return (
    <div>
      <ul data-testid="peers">{peers.map((p) => <li key={p.cid}>{p.label}{p.editing ? `:${p.editing}` : ""}</li>)}</ul>
      <button onClick={() => setEditing("status")}>edit</button>
      <button onClick={() => setEditing(null)}>release</button>
    </div>
  );
}

describe("usePresence", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })));
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens a stream for the room and surfaces other peers (excluding self by cid)", async () => {
    render(<Harness roomId="issue:p1:i1" enabled />);
    const es = MockEventSource.instances[0]!;
    expect(es.url).toContain("/api/presence/rooms/issue%3Ap1%3Ai1/stream?cid=");
    const selfCid = new URL(`http://x${es.url}`).searchParams.get("cid")!;
    act(() => es.emit("presence", { peers: [
      { cid: selfCid, sub: "me", label: "Me", color: "#000", editing: null, editingAt: 0 },
      { cid: "other", sub: "u2", label: "Bo", color: "#111", editing: "status", editingAt: Date.now() },
    ] }));
    await waitFor(() => expect(screen.getByText("Bo:status")).toBeInTheDocument());
    expect(screen.queryByText("Me")).toBeNull(); // self filtered out
  });

  it("POSTs an editing claim and a release", async () => {
    render(<Harness roomId="issue:p1:i1" enabled />);
    act(() => { screen.getByText("edit").click(); });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(JSON.parse((opts as RequestInit).body as string)).toMatchObject({ editing: "status" });
  });

  it("is inert when disabled (no stream opened)", () => {
    render(<Harness roomId="issue:p1:i1" enabled={false} />);
    expect(MockEventSource.instances).toHaveLength(0);
  });
});
