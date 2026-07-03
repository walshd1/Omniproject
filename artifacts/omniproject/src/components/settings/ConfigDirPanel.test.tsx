import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { ConfigDirPanel } from "./ConfigDirPanel";

/**
 * Deployment config-dir status + hot-reload panel. Admin-only; the "Quick update"
 * button goes through step-up before hitting the refresh endpoint.
 */
const STATUS_OK = {
  dir: "/etc/omni-config", present: true, vendors: { backends: 2, brokers: 0, notifications: 0, outputs: 0 },
  configApplied: true, rulesetsApplied: false, artifacts: 0, warnings: [], errors: [],
  backup: { present: false, ageDays: null, stale: false },
};

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 502, json: () => Promise.resolve(body) } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
let responses: Record<string, unknown>;

beforeEach(() => {
  responses = { "/api/setup/config-dir": STATUS_OK };
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const key = init?.method === "POST" ? `POST ${url}` : url;
    if (key in responses) return Promise.resolve(jsonResponse(responses[key]));
    if (url === "/api/auth/step-up") return Promise.resolve(jsonResponse({ ok: true }));
    return Promise.resolve(jsonResponse({}, false));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("ConfigDirPanel", () => {
  it("renders nothing when not admin", () => {
    renderWithProviders(<ConfigDirPanel isAdmin={false} />);
    expect(screen.queryByTestId("config-dir-panel")).not.toBeInTheDocument();
  });

  it("shows the loaded status once fetched", async () => {
    renderWithProviders(<ConfigDirPanel isAdmin={true} />);
    await waitFor(() => expect(screen.getByTestId("config-dir-panel")).toBeInTheDocument());
    expect(screen.getByText(/2 vendor override/)).toBeInTheDocument();
    expect(screen.getByText(/config applied/)).toBeInTheDocument();
  });

  it("shows errors/warnings when present", async () => {
    responses["/api/setup/config-dir"] = { ...STATUS_OK, errors: ["boom.json: bad"], warnings: ["heads up"] };
    renderWithProviders(<ConfigDirPanel isAdmin={true} />);
    await waitFor(() => expect(screen.getByTestId("config-dir-errors")).toHaveTextContent("boom.json: bad"));
    expect(screen.getByTestId("config-dir-warnings")).toHaveTextContent("heads up");
  });

  it("no backup nudge when there is no backup yet", async () => {
    renderWithProviders(<ConfigDirPanel isAdmin={true} />);
    await waitFor(() => expect(screen.getByTestId("config-dir-panel")).toBeInTheDocument());
    expect(screen.queryByTestId("config-dir-backup-nudge")).not.toBeInTheDocument();
  });

  it("shows a stale-backup nudge and clears it on click", async () => {
    responses["/api/setup/config-dir"] = { ...STATUS_OK, backup: { present: true, ageDays: 45, stale: true } };
    responses["POST /api/setup/config-dir/clear-backup"] = { cleared: true };
    renderWithProviders(<ConfigDirPanel isAdmin={true} />);
    await waitFor(() => expect(screen.getByTestId("config-dir-backup-nudge")).toHaveTextContent("45 day"));

    // After clearing, the next status fetch reports no backup.
    responses["/api/setup/config-dir"] = STATUS_OK;
    fireEvent.click(screen.getByRole("button", { name: /clear backup/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/setup/config-dir/clear-backup");
      expect(call).toBeTruthy();
    });
    await waitFor(() => expect(screen.queryByTestId("config-dir-backup-nudge")).not.toBeInTheDocument());
  });

  it("quick update goes through step-up then refreshes and re-fetches status", async () => {
    responses["POST /api/setup/config-dir/refresh"] = { ok: true, reverted: false, backedUp: true, summary: { ...STATUS_OK, backup: undefined } };
    renderWithProviders(<ConfigDirPanel isAdmin={true} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /quick update/i })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /quick update/i }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === "/api/auth/step-up")).toBe(true);
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === "/api/setup/config-dir/refresh")).toBe(true);
    });
    // The status GET is re-issued after the refresh (initial load + post-refresh reload).
    await waitFor(() => {
      const statusCalls = fetchMock.mock.calls.filter((c) => String(c[0]) === "/api/setup/config-dir");
      expect(statusCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("reports a reverted update distinctly (still re-fetches status)", async () => {
    responses["POST /api/setup/config-dir/refresh"] = {
      ok: false, reverted: true, backedUp: false,
      summary: { ...STATUS_OK, errors: [] },
    };
    renderWithProviders(<ConfigDirPanel isAdmin={true} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /quick update/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /quick update/i }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === "/api/setup/config-dir/refresh")).toBe(true);
    });
  });
});
