import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
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

describe("ConnectionsAdmin", () => {
  it("lists backends and is explicit that secrets are never stored", () => {
    const c = client([[["setup-backends"], [{ id: "jira", label: "Jira" }, { id: "openproject", label: "OpenProject" }]]]);
    renderWithProviders(<ConnectionsAdmin />, { client: c });
    expect(screen.getByTestId("backend-jira")).toBeInTheDocument();
    expect(screen.getByTestId("connections-admin")).toHaveTextContent(/never stores these values/i);
  });

  it("shows required credentials + a placeholder template (no values) when a backend is picked", () => {
    const c = client([
      [["setup-backends"], [{ id: "jira", label: "Jira" }]],
      [["setup-connections", "jira"], {
        credentials: [
          { name: "JIRA_INSTANCE_URL", secret: false, backends: ["jira"] },
          { name: "JIRA_BASIC_AUTH", secret: true, backends: ["jira"] },
        ],
        templates: {
          env: "JIRA_BASIC_AUTH=<secret: fill in>   # used by: jira (SECRET)",
          compose: "services:\n  n8n:\n    secrets:\n      - jira_basic_auth",
        },
      }],
    ]);
    renderWithProviders(<ConnectionsAdmin />, { client: c });
    fireEvent.click(screen.getByTestId("backend-jira"));
    const creds = screen.getByTestId("required-credentials");
    expect(creds).toHaveTextContent("JIRA_BASIC_AUTH");
    expect(creds).toHaveTextContent("secret");
    const tpl = screen.getByTestId("credential-template");
    expect(tpl).toHaveTextContent("<secret: fill in>"); // placeholder, never a real value
  });
});
