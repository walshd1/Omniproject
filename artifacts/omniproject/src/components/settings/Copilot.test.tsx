import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { Copilot } from "./Copilot";

/** Read-only portfolio copilot: ask → answer; surfaces errors. */
function client(): QueryClient { return new QueryClient({ defaultOptions: { queries: { retry: false } } }); }

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
const jsonRes = (body: unknown, ok = true, status = 200) => ({ ok, status, json: () => Promise.resolve(body) });

describe("Copilot", () => {
  it("asks and shows the answer", async () => {
    fetchMock.mockResolvedValue(jsonRes({ answer: "Two projects are RED.", projects: 5 }));
    renderWithProviders(<Copilot />, { client: client() });
    fireEvent.change(screen.getByLabelText("Portfolio question"), { target: { value: "which are at risk?" } });
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-answer")).toHaveTextContent("Two projects are RED."));
  });

  it("shows the methodology persona and lets you switch to freeform mode", async () => {
    const copilotBodies = (): Record<string, unknown>[] =>
      fetchMock.mock.calls.filter((c) => c[0] === "/api/ai/copilot").map((c) => JSON.parse(c[1].body));
    fetchMock.mockResolvedValue(jsonRes({ answer: "Risks summarised.", projects: 3, persona: { id: "risk-assurance-manager", title: "Risk & Assurance Manager" } }));
    renderWithProviders(<Copilot />, { client: client() });
    // Default mode is RAG — the request carries mode:"rag" and the persona is shown.
    fireEvent.change(screen.getByLabelText("Portfolio question"), { target: { value: "top risks?" } });
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-persona")).toHaveTextContent("Risk & Assurance Manager"));
    expect(copilotBodies()[0]).toMatchObject({ mode: "rag" });
    // Switch to freeform — the next ask carries mode:"freeform" and no persona is shown.
    fetchMock.mockResolvedValue(jsonRes({ answer: "Plain answer.", projects: 3 }));
    fireEvent.click(screen.getByTestId("copilot-mode-freeform"));
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-answer")).toHaveTextContent("Plain answer."));
    expect(copilotBodies()[1]).toMatchObject({ mode: "freeform" });
    expect(screen.queryByTestId("copilot-persona")).toBeNull();
  });

  it("surfaces an error", async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: "AI is unavailable here" }, false, 403));
    renderWithProviders(<Copilot />, { client: client() });
    fireEvent.change(screen.getByLabelText("Portfolio question"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-error")).toHaveTextContent(/unavailable/));
  });
});
