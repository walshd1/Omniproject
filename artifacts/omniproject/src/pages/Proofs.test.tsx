import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import { Proofs } from "./Proofs";

/** The proofs page: browse proofs, open one into the annotation overlay, record a decision, RBAC-gate. */
const LIST = [{ id: "user~p1", name: "Homepage", version: 1, decision: "pending", updatedAt: "" }];
const PROOF = {
  id: "user~p1", name: "Homepage", version: 1, decision: "pending", updatedAt: "",
  deliverable: { kind: "image", url: "https://cdn.example/home.png" },
  annotations: [{ id: "a1", type: "pin", x: 0.2, y: 0.2, text: "logo" }],
};

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    let body: unknown = {};
    if (url.includes("/api/proofs/user~p1/decision")) body = { ...PROOF, decision: "approved", decisionVersion: 1, decidedBy: "me" };
    else if (url.includes("/api/proofs/user~p1")) body = PROOF;
    else if (url.includes("/api/proofs")) body = LIST;
    else if (url.includes("/api/comments")) body = { comments: [] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
}
function seed(role: string): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  return qc;
}
afterEach(() => vi.restoreAllMocks());

describe("Proofs page", () => {
  it("lists proofs and opens one into the annotation overlay", async () => {
    mockFetch();
    renderWithProviders(<Proofs />, { client: seed("contributor") });
    fireEvent.click(await screen.findByTestId("proof-link-user~p1"));
    expect(await screen.findByTestId("annotation-surface")).toBeInTheDocument();
    expect(screen.getByTestId("deliverable-image")).toBeInTheDocument();
    expect(await screen.findByTestId("annotation-a1")).toBeInTheDocument();
    expect(screen.getByTestId("proof-decision-badge")).toHaveTextContent("Pending");
  });

  it("hides authoring + decision controls from a viewer", async () => {
    mockFetch();
    renderWithProviders(<Proofs />, { client: seed("viewer") });
    fireEvent.click(await screen.findByTestId("proof-link-user~p1"));
    await screen.findByTestId("annotation-surface");
    expect(screen.queryByTestId("proof-new")).not.toBeInTheDocument();
    expect(screen.queryByTestId("proof-decision-bar")).not.toBeInTheDocument();
  });

  it("lets a contributor record an approve decision (POSTs to the decision route)", async () => {
    const fetchSpy = mockFetch();
    renderWithProviders(<Proofs />, { client: seed("contributor") });
    fireEvent.click(await screen.findByTestId("proof-link-user~p1"));
    fireEvent.click(await screen.findByTestId("proof-approve"));
    await new Promise((r) => setTimeout(r, 0));
    const post = fetchSpy.mock.calls.find(([u, o]) =>
      String(u).includes("/api/proofs/user~p1/decision") && (o as RequestInit | undefined)?.method === "POST");
    expect(post, "a decision was POSTed").toBeTruthy();
    expect(String((post![1] as RequestInit).body)).toContain("approved");
  });

  it("shows a general review thread, and switches to a per-annotation thread on select", async () => {
    mockFetch();
    renderWithProviders(<Proofs />, { client: seed("contributor") });
    fireEvent.click(await screen.findByTestId("proof-link-user~p1"));
    const thread = await screen.findByTestId("proof-review-thread");
    expect(thread).toHaveTextContent(/General review/i);
    // Selecting the seeded pin switches the thread to that annotation.
    fireEvent.pointerDown(await screen.findByTestId("annotation-a1"), { pointerId: 1 });
    expect(await screen.findByTestId("proof-review-thread")).toHaveTextContent(/annotation 1/i);
  });

  it("shows an unsupported notice when proofing is off (501)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "off" }), { status: 501 })));
    renderWithProviders(<Proofs />, { client: seed("viewer") });
    expect(await screen.findByTestId("proofs-unsupported")).toBeInTheDocument();
  });
});
