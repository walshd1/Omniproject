import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { GlobalSearchTrigger } from "./GlobalSearchTrigger";
import { useGlobalSearch } from "../../lib/global-search";
import { featuresQueryKey, type FeatureStatus } from "../../lib/features";

function seed(enabled: boolean): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(featuresQueryKey, [
    { id: "globalSearch", label: "Global search", description: "", enabled, loaded: true, needsRestart: false },
  ] satisfies FeatureStatus[]);
  return qc;
}

beforeEach(() => useGlobalSearch.setState({ open: false }));

describe("GlobalSearchTrigger", () => {
  it("renders nothing when global search is disabled", () => {
    const { container } = renderWithProviders(<GlobalSearchTrigger />, { client: seed(false) });
    expect(container.querySelector("button")).toBeNull();
  });

  it("opens the search store when clicked (mouse path)", () => {
    renderWithProviders(<GlobalSearchTrigger />, { client: seed(true) });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(useGlobalSearch.getState().open).toBe(true);
  });
});
