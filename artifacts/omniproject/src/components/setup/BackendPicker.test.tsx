import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { BackendPicker } from "./BackendPicker";
import type { BackendInfo } from "../../lib/setup";

const jira: BackendInfo = {
  id: "jira",
  label: "Jira",
  docsUrl: "https://docs/jira",
  verification: "catalogued",
  via: "REST",
  credentialType: "apiToken",
  requiredEnv: ["JIRA_URL"],
  actions: ["list_issues"],
  capabilities: { issues: true, scheduling: false },
  tier: "standard",
};

const sap: BackendInfo = {
  id: "sap",
  label: "SAP",
  docsUrl: "https://docs/sap",
  verification: "experimental",
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

function Harness() {
  const [backendId, setBackendId] = useState("");
  return <BackendPicker backendId={backendId} setBackendId={setBackendId} />;
}

describe("BackendPicker", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders a tile per known backend plus a 'don't see it' tile", async () => {
    mockBackends([jira, sap]);
    const { findByRole, getByRole } = renderWithProviders(<Harness />);
    expect(await findByRole("option", { name: /jira/i })).toBeInTheDocument();
    expect(getByRole("option", { name: /sap/i })).toBeInTheDocument();
    expect(getByRole("button", { name: /don't see it/i })).toBeInTheDocument();
  });

  it("selects a tile on click", async () => {
    mockBackends([jira, sap]);
    const user = userEvent.setup();
    const { findByRole } = renderWithProviders(<Harness />);
    const jiraTile = await findByRole("option", { name: /jira/i });
    expect(jiraTile).toHaveAttribute("aria-selected", "false");
    await user.click(jiraTile);
    expect(jiraTile).toHaveAttribute("aria-selected", "true");
  });

  it("opens the low-tech vendor request dialog from the 'don't see it' tile", async () => {
    mockBackends([jira]);
    const user = userEvent.setup();
    const { findByRole, getByRole } = renderWithProviders(<Harness />);
    await findByRole("option", { name: /jira/i });
    await user.click(getByRole("button", { name: /don't see it/i }));
    expect(getByRole("heading", { name: /tell us what you use/i })).toBeInTheDocument();
  });

  it("shows each tile's verification badge", async () => {
    mockBackends([jira, sap]);
    const { findByRole, getByRole } = renderWithProviders(<Harness />);
    const jiraTile = await findByRole("option", { name: /jira/i });
    expect(jiraTile).toHaveTextContent("CATALOGUED");
    const sapTile = getByRole("option", { name: /sap/i });
    expect(sapTile).toHaveTextContent("EXPERIMENTAL");
  });

  it("defaults a tile's badge to CATALOGUED when the backend omits verification", async () => {
    const { verification: _omit, ...noVerification } = jira;
    mockBackends([noVerification as BackendInfo]);
    const jiraTile = await renderWithProviders(<Harness />).findByRole("option", { name: /jira/i });
    expect(jiraTile).toHaveTextContent("CATALOGUED");
  });
});
