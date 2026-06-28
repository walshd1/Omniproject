import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
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
});
