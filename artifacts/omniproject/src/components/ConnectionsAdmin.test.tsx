import { describe, it, expect, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../test/utils";
import { ConnectionsAdmin } from "./ConnectionsAdmin";

/**
 * The Connections screen lists required credentials + a fill-in template, and never
 * asks for or shows a secret value.
 */
function client(seed: Array<[unknown[], unknown]>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  for (const [k, v] of seed) qc.setQueryData(k, v);
  return qc;
}

const CONNECTIONS = {
  credentials: [
    { name: "JIRA_INSTANCE_URL", secret: false, backends: ["jira"] },
    { name: "JIRA_BASIC_AUTH", secret: true, backends: ["jira"] },
  ],
  templates: {
    env: "JIRA_BASIC_AUTH=<secret: fill in>   # used by: jira (SECRET)",
    compose: "services:\n  n8n:\n    secrets:\n      - jira_basic_auth",
  },
};

function withJiraPicked(): QueryClient {
  return client([
    [["setup-backends"], [{ id: "jira", label: "Jira" }]],
    [["setup-connections", "jira"], CONNECTIONS],
  ]);
}

afterEach(resetFetchMock);

describe("ConnectionsAdmin", () => {
  it("lists backends and is explicit that secrets are never stored", () => {
    const c = client([[["setup-backends"], [{ id: "jira", label: "Jira" }, { id: "openproject", label: "OpenProject" }]]]);
    renderWithProviders(<ConnectionsAdmin />, { client: c });
    expect(screen.getByTestId("backend-jira")).toBeInTheDocument();
    expect(screen.getByTestId("connections-admin")).toHaveTextContent(/never stores these values/i);
  });

  it("shows required credentials + a placeholder template (no values) when a backend is picked", () => {
    const c = withJiraPicked();
    renderWithProviders(<ConnectionsAdmin />, { client: c });
    fireEvent.click(screen.getByTestId("backend-jira"));
    const creds = screen.getByTestId("required-credentials");
    expect(creds).toHaveTextContent("JIRA_BASIC_AUTH");
    expect(creds).toHaveTextContent("secret");
    const tpl = screen.getByTestId("credential-template");
    expect(tpl).toHaveTextContent("<secret: fill in>"); // placeholder, never a real value
  });

  it("toggling a backend back off hides the required-credentials table", () => {
    const c = withJiraPicked();
    renderWithProviders(<ConnectionsAdmin />, { client: c });
    fireEvent.click(screen.getByTestId("backend-jira"));
    expect(screen.getByTestId("required-credentials")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("backend-jira"));
    expect(screen.queryByTestId("required-credentials")).not.toBeInTheDocument();
    expect(screen.queryByTestId("test-connections")).not.toBeInTheDocument();
  });

  it("tests a connection and shows the reachable status with its detail", async () => {
    mockFetchRouter({ "/api/setup/connections/test": { ok: true, body: { ok: true, detail: "v9.4.2" } } });
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));
    fireEvent.click(screen.getByTestId("test-jira"));
    expect(await screen.findByTestId("status-jira")).toHaveTextContent("ok — v9.4.2");
  });

  it("shows 'unreachable' when the connection test responds but the backend itself isn't reachable", async () => {
    mockFetchRouter({ "/api/setup/connections/test": { ok: true, body: { ok: false } } });
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));
    fireEvent.click(screen.getByTestId("test-jira"));
    expect(await screen.findByTestId("status-jira")).toHaveTextContent("unreachable");
  });

  it("shows the server's error when the test request itself fails", async () => {
    mockFetchRouter({ "/api/setup/connections/test": { ok: false, status: 400, body: { error: "unknown backend" } } });
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));
    fireEvent.click(screen.getByTestId("test-jira"));
    expect(await screen.findByTestId("status-jira")).toHaveTextContent("unknown backend");
  });

  it("relays a secret value to the broker vault, clears the field, and shows the stored ref", async () => {
    const calls = mockFetchRouter({ "/api/setup/connections/vault": { ok: true, body: { stored: true, ref: "vault:jira/JIRA_BASIC_AUTH" } } });
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));

    fireEvent.change(screen.getByTestId("vault-input-JIRA_BASIC_AUTH"), { target: { value: "s3cr3t" } });
    fireEvent.click(screen.getByTestId("vault-send-JIRA_BASIC_AUTH"));

    expect(await screen.findByTestId("vault-ref-JIRA_BASIC_AUTH")).toHaveTextContent("stored → vault:jira/JIRA_BASIC_AUTH");
    expect(screen.getByTestId("vault-input-JIRA_BASIC_AUTH")).toHaveValue("");
    const sent = calls.find((call) => call.url.endsWith("/api/setup/connections/vault"));
    expect(JSON.parse(String(sent!.init!.body))).toEqual({ backend: "jira", name: "JIRA_BASIC_AUTH", value: "s3cr3t" });
  });

  it("shows a failure ref when the vault relay fails", async () => {
    mockFetchRouter({ "/api/setup/connections/vault": { ok: false, status: 500, body: { error: "vault unreachable" } } });
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));

    fireEvent.change(screen.getByTestId("vault-input-JIRA_BASIC_AUTH"), { target: { value: "s3cr3t" } });
    fireEvent.click(screen.getByTestId("vault-send-JIRA_BASIC_AUTH"));

    expect(await screen.findByTestId("vault-ref-JIRA_BASIC_AUTH")).toHaveTextContent("vault unreachable");
  });

  it("sending an empty vault value is a no-op (no request, no ref)", () => {
    const calls = mockFetchRouter({});
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));

    fireEvent.click(screen.getByTestId("vault-send-JIRA_BASIC_AUTH"));
    expect(calls.find((call) => call.url.endsWith("/api/setup/connections/vault"))).toBeUndefined();
    expect(screen.queryByTestId("vault-ref-JIRA_BASIC_AUTH")).not.toBeInTheDocument();
  });

  it("falls back to 'reachable' when a successful test omits the optional detail field", async () => {
    mockFetchRouter({ "/api/setup/connections/test": { ok: true, body: { ok: true } } }); // no detail → "reachable"
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));
    fireEvent.click(screen.getByTestId("test-jira"));
    expect(await screen.findByTestId("status-jira")).toHaveTextContent("ok — reachable");
  });

  it("falls back to 'unsupported' when a failed test response has no error field", async () => {
    mockFetchRouter({ "/api/setup/connections/test": { ok: false, status: 400, body: {} } });
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));
    fireEvent.click(screen.getByTestId("test-jira"));
    expect(await screen.findByTestId("status-jira")).toHaveTextContent("unsupported");
  });

  it("falls back to a generic stored ref when the vault response omits it", async () => {
    mockFetchRouter({ "/api/setup/connections/vault": { ok: true, body: { stored: true } } }); // no ref → "ok"
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));
    fireEvent.change(screen.getByTestId("vault-input-JIRA_BASIC_AUTH"), { target: { value: "s3cr3t" } });
    fireEvent.click(screen.getByTestId("vault-send-JIRA_BASIC_AUTH"));
    expect(await screen.findByTestId("vault-ref-JIRA_BASIC_AUTH")).toHaveTextContent("stored → ok");
  });

  it("falls back to 'failed' when a failed vault response has no error field", async () => {
    mockFetchRouter({ "/api/setup/connections/vault": { ok: false, status: 500, body: {} } });
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));
    fireEvent.change(screen.getByTestId("vault-input-JIRA_BASIC_AUTH"), { target: { value: "s3cr3t" } });
    fireEvent.click(screen.getByTestId("vault-send-JIRA_BASIC_AUTH"));
    expect(await screen.findByTestId("vault-ref-JIRA_BASIC_AUTH")).toHaveTextContent("failed");
  });

  it("clears the vault input even when the relay request itself throws (network failure)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));

    fireEvent.change(screen.getByTestId("vault-input-JIRA_BASIC_AUTH"), { target: { value: "s3cr3t" } });
    fireEvent.click(screen.getByTestId("vault-send-JIRA_BASIC_AUTH"));

    // The plaintext value never lingers in state/input, even on a rejected fetch.
    expect(await screen.findByTestId("vault-ref-JIRA_BASIC_AUTH")).toHaveTextContent("failed");
    expect(screen.getByTestId("vault-input-JIRA_BASIC_AUTH")).toHaveValue("");
  });

  it("shows 'unreachable' when the connection test itself throws (network failure)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));
    fireEvent.click(screen.getByTestId("test-jira"));
    expect(await screen.findByTestId("status-jira")).toHaveTextContent("unreachable");
  });

  it("renders the backend-picker with no checkboxes while the backends list hasn't loaded yet", () => {
    renderWithProviders(<ConnectionsAdmin />, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
    expect(screen.getByTestId("backend-picker")).toBeInTheDocument();
    expect(screen.queryByTestId("backend-jira")).not.toBeInTheDocument();
  });

  it("switches the template format between .env and compose", () => {
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));
    expect(screen.getByTestId("credential-template")).toHaveTextContent("JIRA_BASIC_AUTH=<secret: fill in>");

    fireEvent.click(screen.getByTestId("format-compose"));
    expect(screen.getByTestId("credential-template")).toHaveTextContent("secrets:");

    fireEvent.click(screen.getByTestId("format-env"));
    expect(screen.getByTestId("credential-template")).toHaveTextContent("JIRA_BASIC_AUTH=<secret: fill in>");
  });

  it("copies the current template to the clipboard", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithProviders(<ConnectionsAdmin />, { client: withJiraPicked() });
    fireEvent.click(screen.getByTestId("backend-jira"));

    fireEvent.click(screen.getByTestId("copy-template"));
    expect(writeText).toHaveBeenCalledWith(CONNECTIONS.templates.env);
  });
});
