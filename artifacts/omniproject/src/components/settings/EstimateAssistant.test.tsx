import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { EstimateAssistant } from "./EstimateAssistant";

/**
 * AI estimation assistant: the suggestion is advisory (badged AI·GENERATED) and nothing is
 * "used" until the human explicitly commits it. A null/out-of-range suggestion offers no commit.
 */
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
const jsonRes = (body: unknown, ok = true, status = 200) => ({ ok, status, json: () => Promise.resolve(body) });

describe("EstimateAssistant", () => {
  it("suggests an estimate (badged AI·GENERATED) and only commits on explicit 'use'", async () => {
    fetchMock.mockResolvedValue(jsonRes({ value: 8, unit: "points", rationale: "Comparable to the signup page.", lowConfidence: false }));
    renderWithProviders(<EstimateAssistant />);
    fireEvent.change(screen.getByLabelText("Work to estimate"), { target: { value: "build the login page" } });
    fireEvent.click(screen.getByTestId("estimate-suggest"));

    await waitFor(() => expect(screen.getByTestId("estimate-suggestion")).toHaveTextContent("8 points"));
    expect(screen.getByText("AI · GENERATED")).toBeInTheDocument();
    // Suggestion alone must NOT commit anything.
    expect(screen.queryByTestId("estimate-committed")).toBeNull();

    // Explicit human commit.
    fireEvent.click(screen.getByTestId("estimate-use"));
    expect(screen.getByTestId("estimate-committed")).toHaveTextContent("Using: 8 points");
  });

  it("offers no commit when the model returns no usable value (null)", async () => {
    fetchMock.mockResolvedValue(jsonRes({ value: null, unit: "days", rationale: "Too thin to size.", lowConfidence: true }));
    renderWithProviders(<EstimateAssistant />);
    fireEvent.change(screen.getByLabelText("Work to estimate"), { target: { value: "do the thing" } });
    fireEvent.click(screen.getByTestId("estimate-suggest"));

    await waitFor(() => expect(screen.getByTestId("estimate-suggestion")).toHaveTextContent(/No estimate/i));
    expect(screen.queryByTestId("estimate-use")).toBeNull();
  });

  it("shows a plain error when the capability is off → 403", async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: "AI estimation is unavailable here" }, false, 403));
    renderWithProviders(<EstimateAssistant />);
    fireEvent.change(screen.getByLabelText("Work to estimate"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("estimate-suggest"));
    await waitFor(() => expect(screen.getByTestId("estimate-error")).toBeInTheDocument());
  });
});
