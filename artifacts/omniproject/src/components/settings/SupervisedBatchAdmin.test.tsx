import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { SupervisedBatchAdmin } from "./SupervisedBatchAdmin";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
afterEach(() => vi.unstubAllGlobals());

describe("SupervisedBatchAdmin", () => {
  it("submits a plan, then shows the proposal id + per-step preview", async () => {
    fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({
        batchId: "b-123",
        proposalId: "p-456",
        preview: [
          { kind: "notify", allowed: true },
          { kind: "set-status", allowed: true },
        ],
      }, 202)),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<SupervisedBatchAdmin />);
    fireEvent.click(screen.getByRole("button", { name: /request approval/i }));

    await waitFor(() => expect(screen.getByText(/p-456/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/agentic/batches", expect.objectContaining({ method: "POST" }));
    expect(screen.getByText("set-status")).toBeInTheDocument();
  });

  it("surfaces the gateway error when supervised execution isn't enabled (409)", async () => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ error: "supervised batch execution is not enabled" }, 409)));
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<SupervisedBatchAdmin />);
    fireEvent.click(screen.getByRole("button", { name: /request approval/i }));

    await waitFor(() => expect(screen.getByText(/not enabled/i)).toBeInTheDocument());
  });

  it("rejects invalid JSON locally without calling the gateway", async () => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<SupervisedBatchAdmin />);
    fireEvent.change(screen.getByLabelText(/batch plan/i), { target: { value: "{ not json" } });
    fireEvent.click(screen.getByRole("button", { name: /request approval/i }));

    await waitFor(() => expect(screen.getByText(/not valid JSON/i)).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalledWith("/api/agentic/batches", expect.anything());
  });
});
