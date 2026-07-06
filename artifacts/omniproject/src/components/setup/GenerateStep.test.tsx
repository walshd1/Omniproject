import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { GenerateStep } from "./GenerateStep";
import * as setupLib from "../../lib/setup";
import type { BackendInfo, SetupStatus } from "../../lib/setup";

vi.mock("../../lib/setup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/setup")>();
  return { ...actual, downloadWorkflow: vi.fn().mockResolvedValue(undefined) };
});

// A small harness so the controlled `backendId` prop updates (defaulting to the first
// fetched backend, same as the real Configurator page does via GenerateStep's effect).
function Harness({ url, isAdmin, status }: { url: string; isAdmin: boolean; status: SetupStatus }) {
  const [backendId, setBackendId] = useState("");
  return <GenerateStep url={url} isAdmin={isAdmin} status={status} backendId={backendId} setBackendId={setBackendId} />;
}

const status: SetupStatus = {
  configured: true,
  role: "admin",
  broker: { configured: true, urlSet: true },
  auth: { mode: "demo" },
  ai: { provider: "demo" },
  capabilities: null,
};

const jira: BackendInfo = {
  id: "jira",
  label: "Jira",
  docsUrl: "https://docs/jira",
  via: "REST",
  credentialType: "apiToken",
  requiredEnv: ["JIRA_URL"],
  actions: ["list_issues"],
  capabilities: { issues: true, scheduling: false },
  notes: "Jira note.",
  tier: "standard",
};

const sap: BackendInfo = {
  id: "sap",
  label: "SAP",
  docsUrl: "https://docs/sap",
  via: "OData",
  credentialType: null,
  requiredEnv: [],
  actions: ["list_issues"],
  capabilities: { issues: true },
  tier: "enterprise",
};

function mockBackends(list: BackendInfo[]) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(list),
  }) as unknown as typeof fetch;
}

describe("GenerateStep", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the heading and the loaded backend details", async () => {
    mockBackends([jira]);
    const { getByRole, findByText, getByText } = renderWithProviders(
      <Harness url="https://broker.example.com/webhook/op" isAdmin status={status} />,
    );
    expect(getByRole("heading", { name: "Get the connector for your tool" })).toBeInTheDocument();
    // backend detail panel populated from fetched backends
    expect(await findByText("Jira note.")).toBeInTheDocument();
    expect(getByText("REST")).toBeInTheDocument();
    expect(getByText("JIRA_URL")).toBeInTheDocument();
    expect(getByRole("button", { name: /Download workflow/ })).toBeEnabled();
  });

  it("locks generation for an enterprise backend without entitlement", async () => {
    mockBackends([sap]);
    const { findByText, getByRole } = renderWithProviders(
      <Harness url="" isAdmin status={status} />,
    );
    expect(await findByText(/needs a paid licence key/)).toBeInTheDocument();
    expect(getByRole("button", { name: /Licensed feature/ })).toBeDisabled();
  });

  it("unlocks an enterprise backend when entitled", async () => {
    mockBackends([sap]);
    const entitledStatus: SetupStatus = {
      ...status,
      licensing: { valid: true, tier: "ent", features: ["enterprise_workflows"], expiresInDays: null },
    };
    const { findByText, getByRole, queryByText } = renderWithProviders(
      <Harness url="" isAdmin status={entitledStatus} />,
    );
    expect(await findByText(/SAP API docs/)).toBeInTheDocument();
    expect(queryByText(/needs a paid licence key/)).not.toBeInTheDocument();
    expect(getByRole("button", { name: /Download workflow/ })).toBeEnabled();
  });

  it("disables download for non-admins", async () => {
    mockBackends([jira]);
    const { findByText, getByRole } = renderWithProviders(
      <Harness url="" isAdmin={false} status={status} />,
    );
    await findByText("Jira note.");
    expect(getByRole("button", { name: /Download workflow/ })).toBeDisabled();
  });

  it("renders gracefully when backends fail to load", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("nope")) as unknown as typeof fetch;
    const { getByRole } = renderWithProviders(<Harness url="" isAdmin status={status} />);
    expect(getByRole("heading", { name: "Get the connector for your tool" })).toBeInTheDocument();
  });

  it("defaults the read-only checkbox to checked and downloads read-only by default", async () => {
    mockBackends([jira]);
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(<Harness url="" isAdmin status={status} />);
    await findByText("Jira note.");
    expect(getByRole("checkbox", { name: /Read-only/ })).toBeChecked();

    await user.click(getByRole("button", { name: /Download workflow/ }));
    expect(setupLib.downloadWorkflow).toHaveBeenCalledWith("jira", undefined, true);
  });

  it("passes readOnly: false when the checkbox is unchecked", async () => {
    mockBackends([jira]);
    const user = userEvent.setup();
    const { findByText, getByRole } = renderWithProviders(<Harness url="" isAdmin status={status} />);
    await findByText("Jira note.");

    await user.click(getByRole("checkbox", { name: /Read-only/ }));
    await user.click(getByRole("button", { name: /Download workflow/ }));
    expect(setupLib.downloadWorkflow).toHaveBeenCalledWith("jira", undefined, false);
  });
});
