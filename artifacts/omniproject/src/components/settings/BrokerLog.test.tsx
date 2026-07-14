import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { getGetBrokerLogQueryKey, type BrokerLogEntry } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { BrokerLog } from "./BrokerLog";

// jsdom has no EventSource; a capturing stub lets a test drive the live "entry" stream.
type EntryListener = (e: { data: string }) => void;
let esListeners: Record<string, EntryListener[]>;
let esClosed: boolean;
beforeEach(() => {
  esListeners = {};
  esClosed = false;
  (globalThis as unknown as { EventSource: unknown }).EventSource = class {
    addEventListener(type: string, fn: EntryListener) { (esListeners[type] ??= []).push(fn); }
    close() { esClosed = true; }
  };
});
function emitEntry(data: string) {
  act(() => { for (const fn of esListeners["entry"] ?? []) fn({ data }); });
}

const ENTRIES: BrokerLogEntry[] = [
  { ts: "2026-01-01T10:00:00Z", action: "list_projects", result: "success", status: 200, ms: 12, projectId: null, actor: "alice", note: null },
  { ts: "2026-01-01T10:00:05Z", action: "create_issue", result: "error", status: 502, ms: 40, projectId: "p1", actor: "bob", note: "TimeoutError" },
];

function client(role: string, entries = ENTRIES): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, mode: "demo", user: null, role });
  qc.setQueryData(getGetBrokerLogQueryKey(), entries);
  return qc;
}

describe("BrokerLog", () => {
  it("is hidden for non-admins", () => {
    renderWithProviders(<BrokerLog />, { client: client("manager") });
    expect(screen.queryByTestId("broker-log")).toBeNull();
  });

  it("renders recent broker actions and the failure count for an admin", () => {
    renderWithProviders(<BrokerLog />, { client: client("admin") });
    expect(screen.getByTestId("broker-log")).toBeInTheDocument();
    expect(screen.getByText("list_projects")).toBeInTheDocument();
    expect(screen.getByText("create_issue")).toBeInTheDocument();
    expect(screen.getByTestId("broker-log-errors")).toHaveTextContent("1 failed");
    expect(screen.getByText("TimeoutError")).toBeInTheDocument();
  });

  it("can filter to only failures", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BrokerLog />, { client: client("admin") });
    await user.click(screen.getByLabelText("Only failures"));
    expect(screen.queryByText("list_projects")).toBeNull(); // success row hidden
    expect(screen.getByText("create_issue")).toBeInTheDocument(); // error row stays
  });

  it("shows an empty state when there are no brokered actions yet", () => {
    renderWithProviders(<BrokerLog />, { client: client("admin", []) });
    expect(screen.getByText(/No brokered actions yet/)).toBeInTheDocument();
    expect(screen.getByTestId("broker-log-errors")).toHaveTextContent("0 failed");
  });

  it("appends a live entry from the SSE stream and ignores a malformed frame", () => {
    renderWithProviders(<BrokerLog />, { client: client("admin", []) });
    // A malformed frame is swallowed (the JSON.parse catch) — nothing renders, no throw.
    emitEntry("{ not json");
    expect(screen.getByText(/No brokered actions yet/)).toBeInTheDocument();
    // A well-formed frame is appended live and, being an error, bumps the failure count.
    const live: BrokerLogEntry = { ts: "2026-01-01T11:00:00Z", action: "sync_backend", result: "error", status: 500, ms: 88, projectId: null, actor: "sys", note: "boom" };
    emitEntry(JSON.stringify(live));
    expect(screen.getByText("sync_backend")).toBeInTheDocument();
    expect(screen.getByTestId("broker-log-errors")).toHaveTextContent("1 failed");
  });

  it("closes the SSE channel on unmount", () => {
    const { unmount } = renderWithProviders(<BrokerLog />, { client: client("admin") });
    expect(esClosed).toBe(false);
    unmount();
    expect(esClosed).toBe(true);
  });

  it("exports the log as CSV and JSON via a download anchor", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      renderWithProviders(<BrokerLog />, { client: client("admin") });
      await user.click(screen.getByRole("button", { name: "CSV" }));
      await user.click(screen.getByRole("button", { name: "JSON" }));
      expect(click).toHaveBeenCalledTimes(2);
    } finally {
      click.mockRestore();
    }
  });
});
