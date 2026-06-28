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

  it("surfaces an error", async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: "AI is unavailable here" }, false, 403));
    renderWithProviders(<Copilot />, { client: client() });
    fireEvent.change(screen.getByLabelText("Portfolio question"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("copilot-ask"));
    await waitFor(() => expect(screen.getByTestId("copilot-error")).toHaveTextContent(/unavailable/));
  });
});
