import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import * as Y from "yjs";
import type { DocBlock } from "@workspace/backend-catalogue";
import { useCollabBlocks } from "./collab";
import { writeBlocks, seedUpdateFromBlocks, toBase64, fromBase64 } from "./collab-doc";

/** The co-edit hook: live path (Yjs over the SSE relay) via a mock EventSource, and the local fallback. */
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, ((ev: MessageEvent) => void)[]> = {};
  closed = false;
  constructor(url: string) { this.url = url; MockEventSource.instances.push(this); }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) { (this.listeners[type] ??= []).push(fn); }
  emit(type: string, data: unknown) { for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) } as MessageEvent); }
  close() { this.closed = true; }
}

const INITIAL: DocBlock[] = [{ id: "b1", type: "paragraph", text: "seed" }];

function Harness({ roomId, enabled }: { roomId: string | null; enabled: boolean }) {
  const { blocks, setBlocks, live } = useCollabBlocks(roomId, INITIAL, enabled);
  return (
    <div>
      <span data-testid="live">{String(live)}</span>
      <ul data-testid="blocks">{blocks.map((b) => <li key={b.id}>{b.id}:{(b as { text?: string }).text}</li>)}</ul>
      <button onClick={() => setBlocks([...blocks, { id: "local", type: "paragraph", text: "typed" }])}>add</button>
    </div>
  );
}

/** Every {t:"update"} payload POSTed to the relay, in order. */
function postedUpdates(fetchMock: ReturnType<typeof vi.fn>): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const call of fetchMock.mock.calls) {
    try {
      const body = JSON.parse(String((call[1] as RequestInit).body));
      if (body.msg?.t === "update") { const u = fromBase64(body.msg.u); if (u) out.push(u); }
    } catch { /* ignore */ }
  }
  return out;
}

describe("useCollabBlocks", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })));
  });
  afterEach(() => vi.restoreAllMocks());

  it("goes live, opens the room stream and seeds the persisted blocks", async () => {
    render(<Harness roomId="doc:d1" enabled />);
    expect(screen.getByTestId("live").textContent).toBe("true");
    const es = MockEventSource.instances[0]!;
    expect(es.url).toContain("/api/collab/rooms/doc%3Ad1/stream?cid=");
    await waitFor(() => expect(screen.getByText("b1:seed")).toBeInTheDocument());
  });

  it("broadcasts a local edit as a CRDT update over the relay", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<Harness roomId="doc:d1" enabled />);
    await screen.findByText("b1:seed");
    act(() => { fireEvent.click(screen.getByText("add")); });
    await screen.findByText("local:typed");

    // Applying every posted update to a fresh seeded doc reproduces the local edit — proof it went on the wire.
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, seedUpdateFromBlocks(INITIAL));
    for (const u of postedUpdates(fetchMock)) Y.applyUpdate(fresh, u);
    const ids = fresh.getArray<Y.Map<unknown>>("blocks").toArray().map((m) => m.get("id"));
    expect(ids).toContain("local");
  });

  it("applies a remote peer's update to the local view", async () => {
    render(<Harness roomId="doc:d1" enabled />);
    await screen.findByText("b1:seed");
    const es = MockEventSource.instances[0]!;

    // A peer (seeded identically) adds a block and broadcasts its state.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, seedUpdateFromBlocks(INITIAL));
    writeBlocks(peer, [...INITIAL, { id: "remote", type: "paragraph", text: "theirs" }]);
    act(() => es.emit("collab", { from: "peer-cid", msg: { t: "update", u: toBase64(Y.encodeStateAsUpdate(peer)) } }));

    await waitFor(() => expect(screen.getByText("remote:theirs")).toBeInTheDocument());
  });

  it("falls back to local state (no stream) when co-edit is disabled", async () => {
    render(<Harness roomId="doc:d1" enabled={false} />);
    expect(screen.getByTestId("live").textContent).toBe("false");
    expect(MockEventSource.instances.length).toBe(0);
    act(() => { fireEvent.click(screen.getByText("add")); });
    await screen.findByText("local:typed"); // setBlocks still works locally
  });
});
