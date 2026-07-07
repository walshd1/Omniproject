import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { NlCommand } from "./NlCommand";

/**
 * NL command: plans an instruction, shows the action (read/write), runs on confirm.
 */
function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) };
}

describe("NlCommand", () => {
  it("plans a read action and shows it for review", async () => {
    fetchMock.mockResolvedValue(jsonRes({ plan: { kind: "action", tool: "omniproject_list_projects", action: "list_projects", args: {}, write: false } }));
    renderWithProviders(<NlCommand />, { client: client() });
    fireEvent.change(screen.getByLabelText("Natural-language instruction"), { target: { value: "list projects" } });
    fireEvent.click(screen.getByTestId("nl-plan"));
    await waitFor(() => expect(screen.getByTestId("nl-plan-action")).toBeInTheDocument());
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("list_projects")).toBeInTheDocument();
  });

  it("flags a write action", async () => {
    fetchMock.mockResolvedValue(jsonRes({ plan: { kind: "action", tool: "omniproject_update_issue", action: "update_issue", args: { projectId: "P1", issueId: "42" }, write: true } }));
    renderWithProviders(<NlCommand />, { client: client() });
    fireEvent.change(screen.getByLabelText("Natural-language instruction"), { target: { value: "close 42" } });
    fireEvent.click(screen.getByTestId("nl-plan"));
    await waitFor(() => expect(screen.getByText("write")).toBeInTheDocument());
    expect(screen.getByTestId("nl-run")).toHaveTextContent(/write/i);
  });

  it("shows a clarify question", async () => {
    fetchMock.mockResolvedValue(jsonRes({ plan: { kind: "clarify", question: "Which project?" } }));
    renderWithProviders(<NlCommand />, { client: client() });
    fireEvent.change(screen.getByLabelText("Natural-language instruction"), { target: { value: "show issues" } });
    fireEvent.click(screen.getByTestId("nl-plan"));
    await waitFor(() => expect(screen.getByTestId("nl-clarify")).toHaveTextContent("Which project?"));
  });

  it("surfaces a planning error", async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: "AI is unavailable here" }, false, 403));
    renderWithProviders(<NlCommand />, { client: client() });
    fireEvent.change(screen.getByLabelText("Natural-language instruction"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("nl-plan"));
    await waitFor(() => expect(screen.getByTestId("nl-error")).toHaveTextContent(/unavailable/));
  });

  // These three route by URL (not call order): ContainmentBadge (rendered in the CardTitle)
  // does its own GET /api/ai/containment fetch, which would otherwise consume a slot from a
  // plain mockResolvedValueOnce chain and desync the plan/run sequence.
  it("runs a read action on confirm and shows the result, clearing the plan", async () => {
    mockFetchRouter({
      "POST /api/ai/nl-action": { ok: true, body: { plan: { kind: "action", tool: "omniproject_list_projects", action: "list_projects", args: {}, write: false } } },
      "POST /api/mcp": { ok: true, body: { result: { content: [{ text: "3 projects" }] } } },
    });
    renderWithProviders(<NlCommand />, { client: client() });
    fireEvent.change(screen.getByLabelText("Natural-language instruction"), { target: { value: "list projects" } });
    fireEvent.click(screen.getByTestId("nl-plan"));
    await waitFor(() => expect(screen.getByTestId("nl-plan-action")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("nl-run"));
    await waitFor(() => expect(screen.getByTestId("nl-result")).toHaveTextContent(/3 projects/));
    expect(screen.queryByTestId("nl-plan-action")).not.toBeInTheDocument();
    resetFetchMock();
  });

  it("runs a write action behind its confirm dialog and shows the result", async () => {
    mockFetchRouter({
      "POST /api/ai/nl-action": { ok: true, body: { plan: { kind: "action", tool: "omniproject_update_issue", action: "update_issue", args: { issueId: "42" }, write: true } } },
      "POST /api/mcp": { ok: true, body: { result: { content: [{ text: "updated" }] } } },
    });
    renderWithProviders(<NlCommand />, { client: client() });
    fireEvent.change(screen.getByLabelText("Natural-language instruction"), { target: { value: "close 42" } });
    fireEvent.click(screen.getByTestId("nl-plan"));
    await waitFor(() => expect(screen.getByText("write")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("nl-run")); // opens the confirm dialog
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm & run/i }));
    await waitFor(() => expect(screen.getByTestId("nl-result")).toHaveTextContent(/updated/));
    resetFetchMock();
  });

  it("surfaces an action-run error", async () => {
    mockFetchRouter({
      "POST /api/ai/nl-action": { ok: true, body: { plan: { kind: "action", tool: "omniproject_list_projects", action: "list_projects", args: {}, write: false } } },
      "POST /api/mcp": { ok: true, body: { error: { message: "MCP tool crashed" } } },
    });
    renderWithProviders(<NlCommand />, { client: client() });
    fireEvent.change(screen.getByLabelText("Natural-language instruction"), { target: { value: "list projects" } });
    fireEvent.click(screen.getByTestId("nl-plan"));
    await waitFor(() => expect(screen.getByTestId("nl-plan-action")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("nl-run"));
    await waitFor(() => expect(screen.getByTestId("nl-error")).toHaveTextContent(/mcp tool crashed/i));
    resetFetchMock();
  });

  it("pressing Enter with typed text triggers Plan", async () => {
    fetchMock.mockResolvedValue(jsonRes({ plan: { kind: "action", tool: "omniproject_list_projects", action: "list_projects", args: {}, write: false } }));
    renderWithProviders(<NlCommand />, { client: client() });
    const input = screen.getByLabelText("Natural-language instruction");
    fireEvent.change(input, { target: { value: "list projects" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("nl-plan-action")).toBeInTheDocument());
  });

  it("disables Plan until text is typed", () => {
    renderWithProviders(<NlCommand />, { client: client() });
    expect(screen.getByTestId("nl-plan")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Natural-language instruction"), { target: { value: "x" } });
    expect(screen.getByTestId("nl-plan")).not.toBeDisabled();
  });
});
