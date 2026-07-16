import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import { Whiteboards } from "./Whiteboards";

/** The whiteboards page: browse boards, open one into the native canvas editor, RBAC-gate authoring. */
const BOARDS = [{ id: "wb1", name: "Roadmap", updatedAt: "" }];
const BOARD = {
  id: "wb1", name: "Roadmap", updatedAt: "",
  scene: { elements: [{ id: "s1", type: "sticky", x: 20, y: 20, w: 120, h: 80, text: "Cutover", color: "blue" }] },
};

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    let body: unknown = {};
    if (url.includes("/api/whiteboards/wb1")) body = BOARD;
    else if (url.includes("/api/whiteboards")) body = BOARDS;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
}
function seed(role: string): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("Whiteboards page", () => {
  it("lists boards and opens one into the canvas editor", async () => {
    mockFetch();
    renderWithProviders(<Whiteboards />, { client: seed("contributor") });
    fireEvent.click(await screen.findByTestId("board-link-wb1"));
    // The native SVG editor mounts with its toolbar + surface, and renders the seeded sticky.
    expect(await screen.findByTestId("canvas-surface")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-toolbar")).toBeInTheDocument();
    expect(await screen.findByTestId("canvas-el-s1")).toBeInTheDocument();
  });

  it("hides authoring controls from a viewer", async () => {
    mockFetch();
    renderWithProviders(<Whiteboards />, { client: seed("viewer") });
    await screen.findByTestId("board-link-wb1");
    expect(screen.queryByTestId("whiteboard-new")).not.toBeInTheDocument();
  });

  it("lets a contributor start a new board", async () => {
    mockFetch();
    renderWithProviders(<Whiteboards />, { client: seed("contributor") });
    expect(await screen.findByTestId("whiteboard-new")).toBeInTheDocument();
  });

  it("shows an unsupported notice when the backend has no whiteboards (501)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "unsupported" }), { status: 501 })));
    renderWithProviders(<Whiteboards />, { client: seed("viewer") });
    expect(await screen.findByTestId("whiteboards-unsupported")).toBeInTheDocument();
  });
});
