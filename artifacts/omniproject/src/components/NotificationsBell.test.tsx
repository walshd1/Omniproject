import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getListNotificationsQueryKey, type Notification } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { NotificationsBell } from "./NotificationsBell";

// jsdom has no EventSource; the bell's live channel opens one on mount.
class EventSourceStub {
  static instances: EventSourceStub[] = [];
  url: string;
  onerror: ((e: unknown) => void) | null = null;
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  closed = false;
  constructor(url: string) {
    this.url = url;
    EventSourceStub.instances.push(this);
  }
  addEventListener(type: string, cb: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  close() {
    this.closed = true;
  }
  // Test helpers: synchronously drive the events the component subscribes to.
  emit(type: string, data?: unknown) {
    act(() => { for (const cb of this.listeners[type] ?? []) cb({ data: typeof data === "string" ? data : JSON.stringify(data) }); });
  }
  fail() {
    act(() => { this.onerror?.(new Event("error")); });
  }
}

function seed(notifications: Notification[]): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  qc.setQueryData(getListNotificationsQueryKey(), notifications);
  return qc;
}

const items: Notification[] = [
  { id: "1", kind: "assignment", title: "Unread one", body: "details", read: false, timestamp: new Date().toISOString() },
  { id: "2", kind: "mention", title: "Read two", read: true, timestamp: new Date(Date.now() - 3 * 86400000).toISOString() },
];

describe("NotificationsBell", () => {
  beforeEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = EventSourceStub as unknown;
    EventSourceStub.instances = [];
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the bell trigger with an unread count label", () => {
    const { getByRole } = renderWithProviders(<NotificationsBell />, { client: seed(items) });
    expect(getByRole("button", { name: /1 unread/ })).toBeInTheDocument();
  });

  it("opens the panel and shows notification items", async () => {
    const user = userEvent.setup();
    const { getByRole, getByText } = renderWithProviders(<NotificationsBell />, { client: seed(items) });
    await user.click(getByRole("button", { name: /Notifications/ }));
    expect(getByText("Unread one")).toBeInTheDocument();
    expect(getByText("Read two")).toBeInTheDocument();
    expect(getByText("details")).toBeInTheDocument();
  });

  it("shows an empty state when there are no notifications", async () => {
    const user = userEvent.setup();
    const { getByRole, getByText } = renderWithProviders(<NotificationsBell />, { client: seed([]) });
    await user.click(getByRole("button", { name: /Notifications/ }));
    expect(getByText("Nothing new.")).toBeInTheDocument();
  });

  it("closes the panel on Escape", async () => {
    const user = userEvent.setup();
    const { getByRole, queryByText, getByText } = renderWithProviders(<NotificationsBell />, { client: seed(items) });
    await user.click(getByRole("button", { name: /Notifications/ }));
    expect(getByText("Unread one")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(queryByText("Unread one")).not.toBeInTheDocument();
  });

  it("toggles the live channel off from the panel", async () => {
    const user = userEvent.setup();
    const { getByRole, getByText } = renderWithProviders(<NotificationsBell />, { client: seed(items) });
    await user.click(getByRole("button", { name: /Notifications/ }));
    const toggle = getByText(/CONNECTING|LIVE/);
    await user.click(toggle);
    expect(getByText("LIVE OFF")).toBeInTheDocument();
    expect(window.localStorage.getItem("omni.notify.live")).toBe("off");
  });

  it("opens an EventSource for the live stream", () => {
    renderWithProviders(<NotificationsBell />, { client: seed(items) });
    expect(EventSourceStub.instances.length).toBeGreaterThan(0);
    expect(EventSourceStub.instances[0]!.url).toContain("/api/notifications/stream"); // length asserted > 0 above
  });

  it("marks the channel LIVE once the stream signals ready", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationsBell />, { client: seed([]) });
    EventSourceStub.instances[0]!.emit("ready");
    // The bell title advertises the live channel.
    expect(screen.getByRole("button", { name: /Notifications/ })).toHaveAttribute("title", "Notifications — live");
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("appends a pushed SSE notification and announces it to assistive tech", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<NotificationsBell />, { client: seed([]) });
    const es = EventSourceStub.instances[0]!;
    es.emit("ready");
    es.emit("notification", { id: "live-1", kind: "mention", title: "Live ping", read: false, timestamp: new Date().toISOString() });

    // Announced in the aria-live region...
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent("New notification: Live ping");
    // ...and unread count reflects it.
    expect(screen.getByRole("button", { name: /1 unread/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /1 unread/ }));
    expect(screen.getByText("Live ping")).toBeInTheDocument();
  });

  it("de-dupes a pushed notification that repeats the same id", () => {
    renderWithProviders(<NotificationsBell />, { client: seed([]) });
    const es = EventSourceStub.instances[0]!;
    const n = { id: "dup", kind: "mention", title: "Once", read: false, timestamp: new Date().toISOString() };
    es.emit("notification", n);
    es.emit("notification", n); // same id — ignored
    expect(screen.getByRole("button", { name: /1 unread/ })).toBeInTheDocument();
  });

  it("ignores a malformed SSE payload without crashing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationsBell />, { client: seed([]) });
    EventSourceStub.instances[0]!.emit("notification", "{ not json");
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getByText("Nothing new.")).toBeInTheDocument();
  });

  it("stops reconnecting after five consecutive stream errors", () => {
    renderWithProviders(<NotificationsBell />, { client: seed([]) });
    const es = EventSourceStub.instances[0]!;
    for (let i = 0; i < 4; i++) es.fail();
    expect(es.closed).toBe(false); // still retrying
    es.fail(); // fifth failure trips the breaker
    expect(es.closed).toBe(true);
  });

  it("renders an hours-ago timestamp for a notification a few hours old", async () => {
    const user = userEvent.setup();
    const hoursAgo: Notification = { id: "h", kind: "due_soon", title: "Due soon", read: false, timestamp: new Date(Date.now() - 3 * 3600_000).toISOString() };
    renderWithProviders(<NotificationsBell />, { client: seed([hoursAgo]) });
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.getByText("3h")).toBeInTheDocument();
  });

  it("re-opens a fresh EventSource when the live channel is toggled off then back on", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationsBell />, { client: seed(items) });
    const opened = EventSourceStub.instances.length;
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    await user.click(screen.getByText(/CONNECTING|LIVE/)); // off
    expect(screen.getByText("LIVE OFF")).toBeInTheDocument();
    await user.click(screen.getByText("LIVE OFF")); // back on
    expect(window.localStorage.getItem("omni.notify.live")).toBe("on");
    expect(EventSourceStub.instances.length).toBeGreaterThan(opened);
  });
});
