import { describe, it, expect, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter } from "../../test/utils";
import { Toaster } from "../ui/toaster";
import { WebhooksAdmin } from "./WebhooksAdmin";

/**
 * Outbound-webhooks admin panel: the entitlement gate, the delivery-endpoint list (status dot,
 * events, optional description), and the three write flows (add / delete-with-confirm / test) —
 * none of this had a test file at all before.
 */
interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description?: string;
  secretSet: boolean;
}

function data(webhooks: Webhook[] = [], events: string[] = ["*", "issue.created", "issue.updated"]) {
  return { entitled: true, events, webhooks };
}

function seeded(webhooks: Webhook[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["webhooks"], data(webhooks));
  return qc;
}

const HOOK_A: Webhook = { id: "wh-1", url: "https://a.example.com/hook", events: ["*"], active: true, secretSet: true };
const HOOK_B: Webhook = {
  id: "wh-2",
  url: "https://b.example.com/hook",
  events: ["issue.created", "issue.updated"],
  active: false,
  description: "Slack forwarder",
  secretSet: true,
};

afterEach(() => {
  // mockFetchRouter installs a plain assignment on globalThis.fetch, not a vi.spyOn, so nothing
  // auto-restores it between tests — leaving a stale mock would leak into the next test's
  // (unmocked) background refetch.
  // @ts-expect-error test-only cleanup of the stub installed by mockFetchRouter
  delete globalThis.fetch;
});

describe("WebhooksAdmin", () => {
  it("shows a lock notice and disables the form when not entitled", () => {
    renderWithProviders(<WebhooksAdmin entitled={false} />, { client: seeded() });
    expect(screen.getByText(/Licensed feature/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add webhook/i })).toBeDisabled();
  });

  it("hides the lock notice when entitled", () => {
    renderWithProviders(<WebhooksAdmin entitled />, { client: seeded() });
    expect(screen.queryByText(/Licensed feature/i)).toBeNull();
  });

  it("renders each webhook's status dot, url, events, and optional description", () => {
    const { container } = renderWithProviders(<WebhooksAdmin entitled />, { client: seeded([HOOK_A, HOOK_B]) });
    expect(screen.getByText("https://a.example.com/hook")).toBeInTheDocument();
    expect(screen.getByText("https://b.example.com/hook")).toBeInTheDocument();
    expect(screen.getByText("issue.created, issue.updated · Slack forwarder")).toBeInTheDocument();
    expect(container.querySelectorAll(".rounded-full.bg-green-500")).toHaveLength(1);
    expect(container.querySelectorAll(".rounded-full.bg-muted-foreground")).toHaveLength(1);
  });

  it("disables the Add button until a URL is entered", () => {
    renderWithProviders(<WebhooksAdmin entitled />, { client: seeded() });
    const addButton = screen.getByRole("button", { name: /add webhook/i });
    expect(addButton).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("https://hooks.acme.com/omni"), { target: { value: "https://x.example.com" } });
    expect(addButton).toBeEnabled();
  });

  it("lists the known event types from the query data as a hint", () => {
    renderWithProviders(<WebhooksAdmin entitled />, {
      client: seeded([]), // uses the default events list from data()
    });
    expect(screen.getByText(/Known: \*, issue.created, issue.updated/)).toBeInTheDocument();
  });

  it("adds a webhook: POSTs the trimmed, comma-split events, reveals the secret once, resets the form, and toasts", async () => {
    const calls = mockFetchRouter({
      "/api/webhooks": {
        ok: true,
        body: { webhook: { id: "wh-new", secret: "whsec_abc123" } },
      },
    });
    renderWithProviders(<><WebhooksAdmin entitled /><Toaster /></>, { client: seeded() });

    fireEvent.change(screen.getByPlaceholderText("https://hooks.acme.com/omni"), { target: { value: "https://x.example.com" } });
    fireEvent.change(screen.getByPlaceholderText("*"), { target: { value: " issue.created , issue.updated " } });
    fireEvent.change(screen.getByPlaceholderText("SIEM forwarder"), { target: { value: "My endpoint" } });
    fireEvent.click(screen.getByRole("button", { name: /add webhook/i }));

    expect(await screen.findByText("Signing secret (shown once)")).toBeInTheDocument();
    expect(screen.getByText("whsec_abc123")).toBeInTheDocument();
    expect(await screen.findByText("WEBHOOK ADDED")).toBeInTheDocument();

    const postCall = calls.find((c) => c.init?.method === "POST" && c.url.endsWith("/api/webhooks"));
    expect(postCall).toBeTruthy();
    expect(JSON.parse(String(postCall!.init!.body))).toEqual({
      url: "https://x.example.com",
      events: ["issue.created", "issue.updated"],
      description: "My endpoint",
    });

    // Form resets after a successful add.
    expect(screen.getByPlaceholderText("https://hooks.acme.com/omni")).toHaveValue("");
    expect(screen.getByPlaceholderText("SIEM forwarder")).toHaveValue("");
  });

  it("shows an error toast and reveals no secret when adding a webhook fails", async () => {
    mockFetchRouter({ "/api/webhooks": { ok: false, status: 400, body: { error: "Invalid URL" } } });
    renderWithProviders(<><WebhooksAdmin entitled /><Toaster /></>, { client: seeded() });

    fireEvent.change(screen.getByPlaceholderText("https://hooks.acme.com/omni"), { target: { value: "not-a-url" } });
    fireEvent.click(screen.getByRole("button", { name: /add webhook/i }));

    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Invalid URL")).toBeInTheDocument();
    expect(screen.queryByText("Signing secret (shown once)")).toBeNull();
  });

  it("deletes a webhook after confirming the destructive dialog, and toasts", async () => {
    const calls = mockFetchRouter({ "/api/webhooks/wh-1": { ok: true, body: {} } });
    renderWithProviders(<><WebhooksAdmin entitled /><Toaster /></>, { client: seeded([HOOK_A]) });

    fireEvent.click(screen.getByRole("button", { name: /delete webhook/i }));
    expect(await screen.findByText("Delete webhook?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("WEBHOOK DELETED")).toBeInTheDocument();
    const deleteCall = calls.find((c) => c.init?.method === "DELETE");
    expect(deleteCall?.url).toContain("/api/webhooks/wh-1");
  });

  it("cancelling the destructive dialog sends no request", async () => {
    const calls = mockFetchRouter({});
    renderWithProviders(<WebhooksAdmin entitled />, { client: seeded([HOOK_A]) });

    fireEvent.click(screen.getByRole("button", { name: /delete webhook/i }));
    expect(await screen.findByText("Delete webhook?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText("Delete webhook?")).toBeNull());
    expect(calls.find((c) => c.init?.method === "DELETE")).toBeUndefined();
  });

  it("shows an error toast when deleting a webhook fails", async () => {
    mockFetchRouter({ "/api/webhooks/wh-1": { ok: false, status: 500, body: { error: "Storage unavailable" } } });
    renderWithProviders(<><WebhooksAdmin entitled /><Toaster /></>, { client: seeded([HOOK_A]) });

    fireEvent.click(screen.getByRole("button", { name: /delete webhook/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Storage unavailable")).toBeInTheDocument();
  });

  it("shows TEST DELIVERED with the response status/timing on a successful test delivery", async () => {
    mockFetchRouter({
      "/api/webhooks/wh-1/test": { ok: true, body: { result: { ok: true, status: 200, ms: 42 } } },
    });
    renderWithProviders(<><WebhooksAdmin entitled /><Toaster /></>, { client: seeded([HOOK_A]) });

    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));

    expect(await screen.findByText("TEST DELIVERED")).toBeInTheDocument();
    expect(screen.getByText("HTTP 200 in 42ms")).toBeInTheDocument();
  });

  it("shows TEST FAILED with the error detail when the delivery attempt fails", async () => {
    mockFetchRouter({
      "/api/webhooks/wh-1/test": { ok: true, body: { result: { ok: false, status: 503, ms: 10, error: "connect ECONNREFUSED" } } },
    });
    renderWithProviders(<><WebhooksAdmin entitled /><Toaster /></>, { client: seeded([HOOK_A]) });

    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));

    expect(await screen.findByText("TEST FAILED")).toBeInTheDocument();
    expect(screen.getByText("HTTP 503 in 10ms — connect ECONNREFUSED")).toBeInTheDocument();
  });

  it("disables the Test button when not entitled", () => {
    renderWithProviders(<WebhooksAdmin entitled={false} />, { client: seeded([HOOK_A]) });
    expect(screen.getByRole("button", { name: /^test$/i })).toBeDisabled();
  });

  it("disables the delete trigger when not entitled", () => {
    renderWithProviders(<WebhooksAdmin entitled={false} />, { client: seeded([HOOK_A]) });
    expect(screen.getByRole("button", { name: /delete webhook/i })).toBeDisabled();
  });
});
