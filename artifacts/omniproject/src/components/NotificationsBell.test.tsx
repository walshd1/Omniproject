import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
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
    expect(EventSourceStub.instances[0].url).toContain("/api/notifications/stream");
  });
});
