import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { featuresQueryKey, type FeatureStatus } from "../../lib/features";
import { FeatureModulesAdmin } from "./FeatureModulesAdmin";

function feat(over: Partial<FeatureStatus> = {}): FeatureStatus {
  return { id: "grid", kind: "module", label: "Grid", description: "Editable grid", enabled: true, loaded: true, needsRestart: false, ...over };
}

function seed(features: FeatureStatus[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(featuresQueryKey(), features);
  return qc;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
});

describe("FeatureModulesAdmin", () => {
  it("lists module-kind features only — reports and methodologies are governed elsewhere", () => {
    renderWithProviders(<FeatureModulesAdmin />, {
      client: seed([
        feat({ id: "grid", label: "Grid" }),
        feat({ id: "report:evm", kind: "report", label: "Earned Value" }),
        feat({ id: "methodology:prince2", kind: "methodology", label: "PRINCE2" }),
      ]),
    });
    expect(screen.getByText("Grid")).toBeInTheDocument();
    expect(screen.queryByText("Earned Value")).not.toBeInTheDocument();
    expect(screen.queryByText("PRINCE2")).not.toBeInTheDocument();
  });
});
