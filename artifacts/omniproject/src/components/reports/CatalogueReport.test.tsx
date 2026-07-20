import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { CatalogueReport } from "./CatalogueReport";
import { REPORTS } from "@workspace/backend-catalogue";
import { findReport } from "../../lib/reports-store";

/**
 * CatalogueReport is the one place a page turns a report id into a rendered renderer (via the store +
 * registry). It resolves a known report's registered renderer, renders nothing for a surfaced-elsewhere
 * report (no Reports-card renderer), and shows a placeholder for an unknown id — so no page ever imports a
 * report component directly.
 */
const seeded = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

describe("findReport", () => {
  it("resolves a built-in report by id, and falls back to the bundled catalogue", () => {
    expect(findReport([], "evm")?.renderer.component).toBe("FinancialEvmChart"); // bundled fallback
    expect(findReport(REPORTS, "critical-path")?.renderer.component).toBe("CriticalPath");
    expect(findReport([], "nope")).toBeUndefined();
  });
});

describe("CatalogueReport", () => {
  it("renders a known report's registered renderer (portfolio-rag → PortfolioKpi)", () => {
    renderWithProviders(<CatalogueReport id="portfolio-rag" />, { client: seeded() });
    // PortfolioKpi renders the portfolio KPI heading; assert something from it is on screen.
    expect(document.body.textContent).toBeTruthy();
    expect(screen.queryByText(/Unknown report/)).toBeNull();
  });

  it("renders nothing for a report surfaced elsewhere (gantt → board view, no card renderer)", () => {
    const { container } = renderWithProviders(<CatalogueReport id="gantt" />, { client: seeded() });
    expect(container.textContent).toBe("");
  });

  it("shows a placeholder for an unknown report id", () => {
    renderWithProviders(<CatalogueReport id="does-not-exist" />, { client: seeded() });
    expect(screen.getByText(/Unknown report/)).toBeInTheDocument();
  });
});
