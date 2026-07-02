import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { federatedPeersQueryKey, type FederatedPeerRedacted } from "../../lib/federated-peers";
import { FederatedPeersAdmin } from "./FederatedPeersAdmin";

function seed(role: string | undefined, peers: FederatedPeerRedacted[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(federatedPeersQueryKey, peers);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("FederatedPeersAdmin", () => {
  it("renders nothing for a non-admin session (mirrors the server's admin gate)", () => {
    renderWithProviders(<FederatedPeersAdmin />, { client: seed("pmo", []) });
    expect(screen.queryByTestId("federated-peers-admin")).not.toBeInTheDocument();
  });

  it("shows the empty state with no peers", () => {
    renderWithProviders(<FederatedPeersAdmin />, { client: seed("admin", []) });
    expect(screen.getByTestId("federated-peers-empty")).toBeInTheDocument();
  });

  it("never surfaces a real token — only the redacted mask — for an existing peer", () => {
    renderWithProviders(<FederatedPeersAdmin />, {
      client: seed("admin", [{ id: "eu", label: "EU", baseUrl: "https://eu.omni.example", region: "eu", active: true, tokenSet: true }]),
    });
    expect(screen.getByLabelText("Peer 1 token")).toHaveValue("********");
  });

  it("adds a peer, edits its fields, and saves as a PUT with the peers array", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ peers: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<FederatedPeersAdmin />, { client: seed("admin", []) });

    fireEvent.click(screen.getByText("+ peer"));
    fireEvent.change(screen.getByLabelText("Peer 1 label"), { target: { value: "EU instance" } });
    fireEvent.change(screen.getByLabelText("Peer 1 region"), { target: { value: "eu" } });
    fireEvent.change(screen.getByLabelText("Peer 1 base URL"), { target: { value: "https://eu.omni.example" } });
    fireEvent.change(screen.getByLabelText("Peer 1 token"), { target: { value: "brand-new-token" } });

    fireEvent.click(screen.getByText("Save federated peers"));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/federated-peers")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/federated-peers")!;
    expect((init as RequestInit).method).toBe("PUT");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.peers).toEqual([{ id: expect.any(String), label: "EU instance", baseUrl: "https://eu.omni.example", token: "brand-new-token", region: "eu", active: true }]);
  });

  it("removes a peer", () => {
    renderWithProviders(<FederatedPeersAdmin />, {
      client: seed("admin", [{ id: "eu", label: "EU", baseUrl: "https://eu.omni.example", region: "eu", active: true, tokenSet: false }]),
    });
    expect(screen.getByTestId("federated-peer-edit-0")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Remove"));
    expect(screen.queryByTestId("federated-peer-edit-0")).not.toBeInTheDocument();
  });
});
