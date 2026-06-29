import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { GenerateStep } from "./GenerateStep";
import type { BackendInfo, SetupStatus } from "../../lib/setup";

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
      <GenerateStep url="https://broker.example.com/webhook/op" isAdmin status={status} />,
    );
    expect(getByRole("heading", { name: "Generate a broker workflow" })).toBeInTheDocument();
    // backend detail panel populated from fetched backends
    expect(await findByText("Jira note.")).toBeInTheDocument();
    expect(getByText("REST")).toBeInTheDocument();
    expect(getByText("JIRA_URL")).toBeInTheDocument();
    expect(getByRole("button", { name: /Download workflow/ })).toBeEnabled();
  });

  it("locks generation for an enterprise backend without entitlement", async () => {
    mockBackends([sap]);
    const { findByText, getByRole } = renderWithProviders(
      <GenerateStep url="" isAdmin status={status} />,
    );
    expect(await findByText(/Enterprise integration/)).toBeInTheDocument();
    expect(getByRole("button", { name: /Licensed feature/ })).toBeDisabled();
  });

  it("unlocks an enterprise backend when entitled", async () => {
    mockBackends([sap]);
    const entitledStatus: SetupStatus = {
      ...status,
      licensing: { valid: true, tier: "ent", features: ["enterprise_workflows"], expiresInDays: null },
    };
    const { findByText, getByRole, queryByText } = renderWithProviders(
      <GenerateStep url="" isAdmin status={entitledStatus} />,
    );
    expect(await findByText(/SAP API docs/)).toBeInTheDocument();
    expect(queryByText(/Enterprise integration/)).not.toBeInTheDocument();
    expect(getByRole("button", { name: /Download workflow/ })).toBeEnabled();
  });

  it("disables download for non-admins", async () => {
    mockBackends([jira]);
    const { findByText, getByRole } = renderWithProviders(
      <GenerateStep url="" isAdmin={false} status={status} />,
    );
    await findByText("Jira note.");
    expect(getByRole("button", { name: /Download workflow/ })).toBeDisabled();
  });

  it("renders gracefully when backends fail to load", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("nope")) as unknown as typeof fetch;
    const { getByRole } = renderWithProviders(<GenerateStep url="" isAdmin status={status} />);
    expect(getByRole("heading", { name: "Generate a broker workflow" })).toBeInTheDocument();
  });
});
