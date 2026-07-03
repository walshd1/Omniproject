import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { CustomBackendAdmin } from "./CustomBackendAdmin";

function seed(role: string | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("CustomBackendAdmin", () => {
  it("renders nothing for a non-admin session (PMO doesn't satisfy it — an orthogonal authority)", () => {
    renderWithProviders(<CustomBackendAdmin />, { client: seed("pmo") });
    expect(screen.queryByTestId("custom-backend-admin")).not.toBeInTheDocument();
  });

  it("renders nothing for an unauthenticated session", () => {
    renderWithProviders(<CustomBackendAdmin />, { client: seed(undefined) });
    expect(screen.queryByTestId("custom-backend-admin")).not.toBeInTheDocument();
  });

  it("shows the export button disabled with errors for a blank draft", () => {
    renderWithProviders(<CustomBackendAdmin />, { client: seed("admin") });
    expect(screen.getByTestId("custom-backend-admin")).toBeInTheDocument();
    expect(screen.getByTestId("backend-errors")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export/ })).toBeDisabled();
  });

  it("fills in the core fields and an action, clearing the errors and enabling export", () => {
    renderWithProviders(<CustomBackendAdmin />, { client: seed("admin") });

    fireEvent.change(screen.getByLabelText("Backend id"), { target: { value: "my-tool" } });
    fireEvent.change(screen.getByLabelText("Backend label"), { target: { value: "My Tool" } });
    fireEvent.change(screen.getByLabelText("Backend docs URL"), { target: { value: "https://example.test/docs" } });
    fireEvent.change(screen.getByLabelText("Backend via"), { target: { value: "HTTP + bearer token" } });
    fireEvent.change(screen.getByLabelText("Auth header expression"), { target: { value: "=Bearer {{ $env.MY_TOOL_TOKEN }}" } });

    fireEvent.click(screen.getByLabelText("Map List issues"));
    fireEvent.change(screen.getByLabelText("List issues URL"), { target: { value: "={{ $env.MY_TOOL_URL }}/issues" } });

    expect(screen.queryByTestId("backend-errors")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export my-tool\.json/ })).toBeEnabled();

    const preview = screen.getByTestId("backend-json-preview");
    expect(preview).toHaveTextContent('"id": "my-tool"');
    expect(preview).toHaveTextContent('"list_issues"');
  });

  it("toggling a capability checkbox is reflected in the live preview", () => {
    renderWithProviders(<CustomBackendAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByLabelText("Capability issues"));
    expect(screen.getByTestId("backend-json-preview")).toHaveTextContent('"issues": true');
  });

  it("clones a shipped backend as a starting point", () => {
    renderWithProviders(<CustomBackendAdmin />, { client: seed("admin") });
    fireEvent.change(screen.getByLabelText("Clone an existing backend"), { target: { value: "todoist" } });
    fireEvent.click(screen.getByText("Clone"));
    expect(screen.getByLabelText("Backend id")).toHaveValue("todoist");
    expect(screen.getByLabelText("Backend label")).toHaveValue("Todoist");
    // Cloning a real, already-valid backend leaves nothing to fix...
    expect(screen.queryByTestId("backend-errors")).not.toBeInTheDocument();
    // ...but does warn that exporting it will override the shipped one.
    expect(screen.getByTestId("backend-warnings")).toHaveTextContent(/OVERRIDE/);
  });

  it("exports the built manifest as a JSON download", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    renderWithProviders(<CustomBackendAdmin />, { client: seed("admin") });

    fireEvent.change(screen.getByLabelText("Clone an existing backend"), { target: { value: "todoist" } });
    fireEvent.click(screen.getByText("Clone"));
    fireEvent.click(screen.getByRole("button", { name: /Export todoist\.json/ }));
    expect(click).toHaveBeenCalled();
  });

  it("imports a hand-authored definition file", async () => {
    renderWithProviders(<CustomBackendAdmin />, { client: seed("admin") });
    const def = {
      id: "imported-tool", label: "Imported Tool", docsUrl: "https://example.test", via: "HTTP",
      requiredEnv: [], capabilities: { issues: true }, authHeader: "=Bearer x",
      actions: { list_issues: { method: "GET", url: "https://example.test/issues" } },
    };
    const file = new File([JSON.stringify(def)], "imported-tool.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve(JSON.stringify(def)) });

    fireEvent.change(screen.getByLabelText("Import backend definition"), { target: { files: [file] } });
    expect(await screen.findByLabelText("Backend id")).toHaveValue("imported-tool");
    expect(screen.getByLabelText("Map List issues")).toBeChecked();
  });

  it("rejects a non-JSON file on import with a friendly error", async () => {
    renderWithProviders(<CustomBackendAdmin />, { client: seed("admin") });
    const file = new File(["not json"], "bad.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve("not json") });
    fireEvent.change(screen.getByLabelText("Import backend definition"), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/valid JSON/);
  });

  it("switches an action's transport to an n8n node and edits its parameters", () => {
    renderWithProviders(<CustomBackendAdmin />, { client: seed("admin") });
    fireEvent.click(screen.getByLabelText("Map List projects"));
    fireEvent.change(screen.getByLabelText("List projects transport"), { target: { value: "n8nNode" } });
    fireEvent.change(screen.getByLabelText("List projects node type"), { target: { value: "n8n-nodes-base.asana" } });
    fireEvent.change(screen.getByLabelText("List projects parameters"), { target: { value: "{not-json" } });

    const errors = screen.getByTestId("backend-errors");
    expect(within(errors).getByText(/parameters is not valid JSON/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export/ })).toBeDisabled();
  });

  it("disables Suggest until a vendor name is entered", () => {
    renderWithProviders(<CustomBackendAdmin />, { client: seed("admin") });
    expect(screen.getByRole("button", { name: /Suggest/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Vendor name to suggest"), { target: { value: "Smartsheet" } });
    expect(screen.getByRole("button", { name: /Suggest/ })).toBeEnabled();
  });

  it("loads an AI-suggested draft through the same path as an imported file", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        manifest: {
          id: "smartsheet", label: "Smartsheet", docsUrl: "https://developers.smartsheet.com",
          via: "API key", requiredEnv: ["SMARTSHEET_API_BASE"], capabilities: { issues: true },
          notes: "AI-suggested, unverified — review before use.",
        },
      }),
    }) as unknown as typeof fetch;

    renderWithProviders(<CustomBackendAdmin />, { client: seed("admin") });
    fireEvent.change(screen.getByLabelText("Vendor name to suggest"), { target: { value: "Smartsheet" } });
    fireEvent.click(screen.getByRole("button", { name: /Suggest/ }));

    expect(await screen.findByLabelText("Backend id")).toHaveValue("smartsheet");
    expect(screen.getByLabelText("Backend via")).toHaveValue("API key");
    // No actions are suggested — the preview must not fabricate any endpoint mapping.
    expect(screen.getByTestId("backend-json-preview")).toHaveTextContent(/"actions": \{\}/);
  });

  it("shows a friendly error when the suggestion request fails (e.g. the capability is off)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "AI backend drafting is unavailable here: capability \"backend-draft\" is turned off" }),
    }) as unknown as typeof fetch;

    renderWithProviders(<CustomBackendAdmin />, { client: seed("admin") });
    fireEvent.change(screen.getByLabelText("Vendor name to suggest"), { target: { value: "Smartsheet" } });
    fireEvent.click(screen.getByRole("button", { name: /Suggest/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/turned off/);
  });
});
