import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { MessyDataControl } from "./MessyDataControl";

/**
 * The messy-data control renders only on a dev instance and reflects the current
 * config (on/off, intensity, seed) plus the gremlin catalogue.
 */
function client(seed: Record<string, unknown>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  for (const [k, v] of Object.entries(seed)) qc.setQueryData([k], v);
  return qc;
}

const messyState = {
  config: { on: true, seed: "omni", intensity: 0.4, gremlins: [] as string[] },
  gremlins: [
    { id: "nullify", label: "Null values", description: "Sets optional fields to null." },
    { id: "duplicateId", label: "Duplicate ids", description: "Reuses another row's id." },
  ],
};

describe("MessyDataControl", () => {
  it("renders nothing when not a dev instance", () => {
    const c = client({ "dev-mode": { devMode: false }, "dev-messy": messyState });
    renderWithProviders(<MessyDataControl />, { client: c });
    expect(screen.queryByTestId("messy-open")).not.toBeInTheDocument();
  });

  it("shows the config + gremlin catalogue on a dev instance", () => {
    const c = client({ "dev-mode": { devMode: true }, "dev-messy": messyState });
    renderWithProviders(<MessyDataControl />, { client: c });
    fireEvent.click(screen.getByTestId("messy-open"));
    expect(screen.getByTestId("messy-on")).toBeChecked();
    // An empty gremlin list means "all active", so every catalogue entry is checked.
    expect(screen.getByTestId("messy-gremlin-nullify")).toBeChecked();
    expect(screen.getByTestId("messy-gremlin-duplicateId")).toBeChecked();
    expect(screen.getByTestId("messy-gremlins")).toHaveTextContent("Duplicate ids");
  });
});
