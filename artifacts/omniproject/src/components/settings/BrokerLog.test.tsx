import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { getGetBrokerLogQueryKey, type BrokerLogEntry } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { BrokerLog } from "./BrokerLog";

// jsdom has no EventSource; stub it so the live channel mounts without error.
beforeEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = class {
    addEventListener() {}
    close() {}
  };
});

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
});
