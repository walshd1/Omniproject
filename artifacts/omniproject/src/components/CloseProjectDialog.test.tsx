import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { CloseProjectDialog } from "./CloseProjectDialog";

// Auth: control the role so we can assert the admin/PMO gate.
let role = "admin";
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ data: { role } }),
  isPmoOrAdmin: (r?: string) => r === "admin" || r === "pmo",
}));

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ guid: "g1", disposition: "archive" })));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("CloseProjectDialog", () => {
  it("renders nothing for a non-admin/PMO", () => {
    role = "contributor";
    renderWithProviders(<CloseProjectDialog projectGuid="g1" projectName="Apollo" />);
    expect(screen.queryByText("Close project…")).not.toBeInTheDocument();
  });

  it("closes with the chosen disposition via POST /projects/:guid/close", async () => {
    role = "admin";
    renderWithProviders(<CloseProjectDialog projectGuid="g1" projectName="Apollo" source="jira" />);
    fireEvent.click(screen.getByText("Close project…"));
    fireEvent.change(await screen.findByDisplayValue("Leave in the current system of record"), { target: { value: "archive" } });
    fireEvent.click(screen.getByRole("button", { name: /close project/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(post?.[0]).toBe("/api/projects/g1/close");
      expect(JSON.parse(String(post![1].body)).disposition).toBe("archive");
    });
  });
});
