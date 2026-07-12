import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { CalendarPushConsent } from "./CalendarPushConsent";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 403, json: () => Promise.resolve(body) } as Response;
}

let grant = { granted: false, target: null as string | null, scope: "mine", grantedAt: null as string | null };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  grant = { granted: false, target: null, scope: "mine", grantedAt: null };
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/calendar/push" && init?.method === "PUT") {
      const patch = JSON.parse(String(init.body));
      grant = { ...grant, ...patch, grantedAt: patch.granted ? "now" : null };
      return Promise.resolve(jsonResponse(grant));
    }
    if (url === "/api/calendar/push") return Promise.resolve(jsonResponse(grant));
    return Promise.resolve(jsonResponse({}, false));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("CalendarPushConsent", () => {
  it("is off by default and shows no destination selector until granted", async () => {
    renderWithProviders(<CalendarPushConsent />);
    const toggle = await screen.findByLabelText("Enable calendar push");
    expect(toggle).not.toBeChecked();
    expect(screen.queryByText("Destination")).not.toBeInTheDocument();
  });

  it("granting sends an explicit consent PUT with a target", async () => {
    renderWithProviders(<CalendarPushConsent />);
    const toggle = await screen.findByLabelText("Enable calendar push");
    fireEvent.click(toggle);
    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(String(put![1].body));
      expect(body.granted).toBe(true);
      expect(body.target).toBe("google-calendar");
    });
  });
});
