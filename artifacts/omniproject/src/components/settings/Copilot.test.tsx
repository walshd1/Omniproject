import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { installFakeSpeechRecognition } from "../../test/fake-speech-recognition";
import { Copilot } from "./Copilot";

/**
 * Portfolio copilot: Q&A stays the default/fallback. Every message is first offered to the
 * SAME NL→action planner the command palette uses (`/api/ai/nl-action`); a "none" verdict
 * falls through to the unchanged read-only `/api/ai/copilot` Q&A call. A recognised action
 * (or a clarify) shows the SAME confirm-before-execute plan card instead, and only executes
 * (via `/api/mcp`) after the identical write-confirm gate the command palette uses.
 */
function client(): QueryClient { return new QueryClient({ defaultOptions: { queries: { retry: false } } }); }

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
const jsonRes = (body: unknown, ok = true, status = 200) => ({ ok, status, json: () => Promise.resolve(body) });

/** No message in these Q&A tests is action-shaped, so the planner always says "none" and
 *  the flow falls through to the `answerPayload` served for `/api/ai/copilot`. */
function mockPlannerNoneThenAnswer(getAnswerPayload: () => { body: unknown; ok?: boolean; status?: number }) {
  fetchMock.mockImplementation((url: string) => {
    if (url === "/api/ai/nl-action") return Promise.resolve(jsonRes({ plan: { kind: "none", reason: "not an action" } }));
    const { body, ok, status } = getAnswerPayload();
    return Promise.resolve(jsonRes(body, ok, status));
  });
}

describe("Copilot — Q&A (fallback when the planner finds no action)", () => {
  it("asks and shows the answer", async () => {
    mockPlannerNoneThenAnswer(() => ({ body: { answer: "Two projects are RED.", projects: 5 } }));
    renderWithProviders(<Copilot />, { client: client() });
    fireEvent.change(screen.getByLabelText("Portfolio question"), { target: { value: "which are at risk?" } });
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-answer")).toHaveTextContent("Two projects are RED."));
  });

  it("shows the methodology persona and lets you switch to freeform mode", async () => {
    const copilotBodies = (): Record<string, unknown>[] =>
      fetchMock.mock.calls.filter((c) => c[0] === "/api/ai/copilot").map((c) => JSON.parse(c[1].body));
    let answer: unknown = { answer: "Risks summarised.", projects: 3, persona: { id: "risk-assurance-manager", title: "Risk & Assurance Manager" } };
    mockPlannerNoneThenAnswer(() => ({ body: answer }));
    renderWithProviders(<Copilot />, { client: client() });
    // Default mode is RAG — the request carries mode:"rag" and the persona is shown.
    fireEvent.change(screen.getByLabelText("Portfolio question"), { target: { value: "top risks?" } });
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-persona")).toHaveTextContent("Risk & Assurance Manager"));
    expect(copilotBodies()[0]).toMatchObject({ mode: "rag" });
    // Switch to freeform — the next ask carries mode:"freeform" and no persona is shown.
    answer = { answer: "Plain answer.", projects: 3 };
    fireEvent.click(screen.getByTestId("copilot-mode-freeform"));
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-answer")).toHaveTextContent("Plain answer."));
    expect(copilotBodies()[1]).toMatchObject({ mode: "freeform" });
    expect(screen.queryByTestId("copilot-persona")).toBeNull();
    // Back to RAG — the toggle round-trips and the next ask carries mode:"rag" again.
    answer = { answer: "Risks again.", projects: 3, persona: { id: "risk-assurance-manager", title: "Risk & Assurance Manager" } };
    fireEvent.click(screen.getByTestId("copilot-mode-rag"));
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-persona")).toHaveTextContent("Risk & Assurance Manager"));
    expect(copilotBodies()[2]).toMatchObject({ mode: "rag" });
  });

  it("surfaces an error from the Q&A call", async () => {
    mockPlannerNoneThenAnswer(() => ({ body: { error: "AI is unavailable here" }, ok: false, status: 403 }));
    renderWithProviders(<Copilot />, { client: client() });
    fireEvent.change(screen.getByLabelText("Portfolio question"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-error")).toHaveTextContent(/unavailable/));
  });

  it("surfaces a planning error without ever reaching the Q&A call", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/ai/nl-action") return Promise.resolve(jsonRes({ error: "AI is unavailable here" }, false, 403));
      throw new Error("unexpected call to " + url);
    });
    renderWithProviders(<Copilot />, { client: client() });
    fireEvent.change(screen.getByLabelText("Portfolio question"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-error")).toHaveTextContent(/unavailable/));
  });

  it("pressing Enter with a typed question asks; Enter on an empty field does nothing", async () => {
    mockPlannerNoneThenAnswer(() => ({ body: { answer: "Answered via Enter." } }));
    renderWithProviders(<Copilot />, { client: client() });
    const input = screen.getByLabelText("Portfolio question");
    // Empty field: Enter is a no-op (guard is `question.trim()`), so the planner isn't hit.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/ai/nl-action")).toBe(false);
    // With text, Enter triggers the ask.
    fireEvent.change(input, { target: { value: "status?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("copilot-answer")).toHaveTextContent("Answered via Enter."));
  });

  it("dictated speech appends into the question field", () => {
    const c = client();
    c.setQueryData(["ai-stt"], { provider: "browser" });
    const instances = installFakeSpeechRecognition();
    renderWithProviders(<Copilot />, { client: c });
    fireEvent.click(screen.getByTestId("dictate-button"));
    const rec = instances[0]!;
    act(() => rec.onresult?.({ results: [[{ transcript: "which projects" }]] }));
    const input = screen.getByLabelText("Portfolio question") as HTMLInputElement;
    expect(input.value).toBe("which projects");
    act(() => rec.onresult?.({ results: [[{ transcript: "are at risk" }]] }));
    expect(input.value).toBe("which projects are at risk");
  });
});

describe("Copilot — action invocation (same planner + confirm gate as the command palette)", () => {
  it("detects a read action and shows the plan card instead of asking the Q&A model", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/ai/nl-action") {
        return Promise.resolve(jsonRes({ plan: { kind: "action", tool: "omniproject_list_projects", action: "list_projects", args: {}, write: false } }));
      }
      throw new Error("unexpected call to " + url);
    });
    renderWithProviders(<Copilot />, { client: client() });
    fireEvent.change(screen.getByLabelText("Portfolio question"), { target: { value: "list my projects" } });
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-plan-action")).toBeInTheDocument());
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("list_projects")).toBeInTheDocument();
    // The Q&A endpoint was never called — a recognised action pre-empts it.
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/ai/copilot")).toBe(false);
  });

  it("shows a clarify question inline, same as the command palette", async () => {
    fetchMock.mockResolvedValue(jsonRes({ plan: { kind: "clarify", question: "Which project?" } }));
    renderWithProviders(<Copilot />, { client: client() });
    fireEvent.change(screen.getByLabelText("Portfolio question"), { target: { value: "show issues" } });
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-clarify")).toHaveTextContent("Which project?"));
  });

  it("flags a write action and only runs it after an explicit confirm dialog", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/ai/nl-action") {
        return Promise.resolve(jsonRes({ plan: { kind: "action", tool: "omniproject_update_issue", action: "update_issue", args: { projectId: "P1", issueId: "42", status: "done" }, write: true } }));
      }
      if (url === "/api/mcp") return Promise.resolve(jsonRes({ result: { content: [{ text: "ok" }] } }));
      throw new Error("unexpected call to " + url);
    });
    renderWithProviders(<Copilot />, { client: client() });
    fireEvent.change(screen.getByLabelText("Portfolio question"), { target: { value: "mark 42 done" } });
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-plan-action")).toBeInTheDocument());
    expect(screen.getByText("write")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("copilot-run")); // opens the confirm dialog
    const dialog = await screen.findByRole("alertdialog");
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/mcp")).toBe(false); // not yet
    fireEvent.click(within(dialog).getByRole("button", { name: /confirm & run/i }));
    await waitFor(() => expect(screen.getByTestId("copilot-result")).toBeInTheDocument());
  });

  it("surfaces an error when the confirmed action fails to execute", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/ai/nl-action") {
        return Promise.resolve(jsonRes({ plan: { kind: "action", tool: "omniproject_list_projects", action: "list_projects", args: {}, write: false } }));
      }
      if (url === "/api/mcp") return Promise.resolve(jsonRes({ error: { message: "MCP tool crashed" } }));
      throw new Error("unexpected call to " + url);
    });
    renderWithProviders(<Copilot />, { client: client() });
    fireEvent.change(screen.getByLabelText("Portfolio question"), { target: { value: "list projects" } });
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-plan-action")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("copilot-run")); // read action → runs immediately, no dialog
    await waitFor(() => expect(screen.getByTestId("copilot-error")).toHaveTextContent(/mcp tool crashed/i));
  });

  it("declining the write confirm dialog never calls the execute endpoint", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/ai/nl-action") {
        return Promise.resolve(jsonRes({ plan: { kind: "action", tool: "omniproject_delete_issue", action: "delete_issue", args: { projectId: "P1", issueId: "42" }, write: true } }));
      }
      throw new Error("unexpected call to " + url);
    });
    renderWithProviders(<Copilot />, { client: client() });
    fireEvent.change(screen.getByLabelText("Portfolio question"), { target: { value: "delete 42" } });
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-plan-action")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("copilot-run"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/mcp")).toBe(false);
    expect(screen.getByTestId("copilot-plan-action")).toBeInTheDocument();
  });
});
