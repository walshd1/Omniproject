import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { CANONICAL_FIELD_KEYS } from "@workspace/backend-catalogue";
import { renderWithProviders } from "../test/utils";
import { fieldRoutingQueryKey } from "./routing";
import { customFieldsQueryKey } from "./custom-fields";
import { availabilityQueryKey } from "./availability";
import { usePickableFields } from "./pickable-fields";

function Probe() {
  const p = usePickableFields();
  return (
    <div>
      <span data-testid="restricted">{String(p.restricted)}</span>
      <span data-testid="count">{p.fields.length}</span>
      <span data-testid="fields">{p.fields.join(",")}</span>
    </div>
  );
}

function base(role = "admin"): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(fieldRoutingQueryKey, []);
  qc.setQueryData(customFieldsQueryKey, []);
  return qc;
}

describe("usePickableFields", () => {
  it("falls back to the full superset when no live broker advertises fields", () => {
    renderWithProviders(<Probe />, { client: base() });
    expect(screen.getByTestId("restricted").textContent).toBe("false");
    expect(Number(screen.getByTestId("count").textContent)).toBe(CANONICAL_FIELD_KEYS.size);
  });

  it("narrows to advertised ∪ mapped ∪ custom when a live broker is wired", () => {
    const qc = base();
    qc.setQueryData(fieldRoutingQueryKey, [{ uiElement: "dueDate", vendor: "jira", broker: "n8n", sourceField: "duedate" }]);
    qc.setQueryData(customFieldsQueryKey, [{ key: "riskAppetite", label: "Risk appetite", type: "string" }]);
    qc.setQueryData(availabilityQueryKey, { source: "capabilities", fields: ["budget", "status"], available: ["budget", "status"], hidden: [], tables: [], relationships: [] });
    qc.setQueryData(["setup", "status"], { broker: { configured: true } });
    renderWithProviders(<Probe />, { client: qc });

    expect(screen.getByTestId("restricted").textContent).toBe("true");
    const fields = screen.getByTestId("fields").textContent!.split(",");
    expect(fields.sort()).toEqual(["budget", "dueDate", "riskAppetite", "status"]); // advertised ∪ mapped ∪ custom
  });
});
