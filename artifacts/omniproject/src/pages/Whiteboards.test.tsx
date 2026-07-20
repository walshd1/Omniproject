import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, type Project } from "@workspace/api-client-react";
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
    else if (url.includes("/api/projects")) body = [{ id: "p1", name: "Apollo", identifier: "APO", source: "plane" }];
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

  it("offers SVG + PNG export once a board is open (even to a viewer — export is client-side)", async () => {
    mockFetch();
    renderWithProviders(<Whiteboards />, { client: seed("viewer") });
    fireEvent.click(await screen.findByTestId("board-link-wb1"));
    expect(await screen.findByTestId("whiteboard-export-svg")).toBeInTheDocument();
    expect(screen.getByTestId("whiteboard-export-png")).toBeInTheDocument();
  });

  it("converts a selected sticky into a work item (POSTs an issue to the chosen project)", async () => {
    const fetchSpy = mockFetch();
    const qc = seed("contributor");
    qc.setQueryData(getListProjectsQueryKey(), [{ id: "p1", name: "Apollo", identifier: "APO", source: "plane" }] as Project[]);
    renderWithProviders(<Whiteboards />, { client: qc });
    fireEvent.click(await screen.findByTestId("board-link-wb1"));
    // The projects are seeded, so the convert target (p1) is chosen before we convert.
    const picker = await screen.findByTestId("whiteboard-convert-project") as HTMLSelectElement;
    expect(picker.value).toBe("p1");
    // Select the seeded sticky (bounds 20..140 x, 20..100 y) via a pointer-down on the canvas surface.
    fireEvent.pointerDown(await screen.findByTestId("canvas-surface"), { clientX: 30, clientY: 30, pointerId: 1 });
    fireEvent.click(await screen.findByTestId("canvas-to-issue"));
    await new Promise((r) => setTimeout(r, 0));
    const issuePost = fetchSpy.mock.calls.find(([u, o]) =>
      String(u).includes("/api/projects/p1/issues") && (o as RequestInit | undefined)?.method === "POST");
    expect(issuePost, "an issue was POSTed to the selected project").toBeTruthy();
    expect(String((issuePost![1] as RequestInit).body)).toContain("Cutover");
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
