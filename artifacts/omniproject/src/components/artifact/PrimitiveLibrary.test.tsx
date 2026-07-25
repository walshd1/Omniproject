import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PrimitiveLibrary } from "./PrimitiveLibrary";
import { PRIMITIVE_CATALOGUE } from "../charts/catalogue";
import { primitivesByFamily } from "../../lib/primitive-store";
import * as api from "../../lib/api";

/**
 * PrimitiveLibrary now renders the WHOLE shared store (all families) grouped into subfolders, with viz
 * primitives keeping their chart-catalogue detail.
 */
describe("PrimitiveLibrary", () => {
  it("renders every family section and a card for every viz catalogue primitive under its subfolder", () => {
    render(<PrimitiveLibrary />);
    for (const fam of ["panel", "viz", "field", "component"]) {
      expect(screen.getByTestId(`primitive-library-family-${fam}`)).toBeInTheDocument();
    }
    for (const p of PRIMITIVE_CATALOGUE) {
      expect(screen.getByTestId(`primitive-library-item-viz-${p.id}`)).toBeInTheDocument();
    }
    // viz subfolders are present.
    expect(screen.getByTestId("primitive-library-chart")).toBeInTheDocument();
    expect(screen.getByTestId("primitive-library-tile")).toBeInTheDocument();
  });

  it("shows viz primitives' required inputs and primitive tags", () => {
    render(<PrimitiveLibrary />);
    expect(screen.getByTestId("primitive-library-item-viz-gantt").textContent).toContain("Items");
    // A form field primitive appears (unified store), with its tag.
    expect(screen.getByTestId("primitive-library-item-field-email")).toBeInTheDocument();
    expect(screen.getByTestId("primitive-library-tags-field-email").textContent).toContain("validated");
  });

  it("offers a Use action only when onPick is given, and calls it with the store primitive", () => {
    const onPick = vi.fn();
    const { rerender } = render(<PrimitiveLibrary />);
    expect(screen.queryByTestId("primitive-library-pick-viz-bar")).toBeNull();
    rerender(<PrimitiveLibrary onPick={onPick} />);
    fireEvent.click(screen.getByTestId("primitive-library-pick-viz-bar"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "bar", family: "viz" }));
  });

  it("scopes to a placement surface: surface=form shows only the field family", () => {
    render(<PrimitiveLibrary surface="form" />);
    expect(screen.getByTestId("primitive-library-family-field")).toBeInTheDocument();
    expect(screen.queryByTestId("primitive-library-family-panel")).toBeNull();
    for (const p of primitivesByFamily("field")) {
      expect(screen.getByTestId(`primitive-library-item-field-${p.id}`)).toBeInTheDocument();
    }
  });

  describe("includeActivated: folds customer-activated primitives from the def store into the palette", () => {
    afterEach(() => vi.restoreAllMocks());
    const wrap = (node: ReactNode) => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
    };

    it("shows an org-activated primitive alongside the shipped vocabulary", async () => {
      const getJson = vi.spyOn(api, "getJson").mockResolvedValue([
        { id: "org~reg-abc", kind: "primitive", name: "Acme tile", storage: "org", createdBy: "ada", createdAt: "", updatedAt: "", rowVersion: 1,
          payload: { id: "acme-tile", label: "Acme tile", category: "custom" } },
      ]);
      wrap(<PrimitiveLibrary surface="report" includeActivated />);
      // The activated org primitive appears once loaded …
      await waitFor(() => expect(screen.getByTestId("primitive-library-item-viz-acme-tile")).toBeInTheDocument());
      // … tagged by its origin scope, and it hit the resolved-primitive route.
      expect(screen.getByTestId("primitive-library-tags-viz-acme-tile").textContent).toContain("org");
      expect(getJson).toHaveBeenCalledWith(expect.stringContaining("/api/defs/resolved/primitive"));
      // The shipped vocabulary is still present.
      expect(screen.getByTestId("primitive-library-item-viz-bar")).toBeInTheDocument();
    });

    it("degrades to the shipped palette when the def store yields nothing", async () => {
      vi.spyOn(api, "getJson").mockResolvedValue([]);
      wrap(<PrimitiveLibrary surface="report" includeActivated />);
      await waitFor(() => expect(screen.getByTestId("primitive-library-item-viz-bar")).toBeInTheDocument());
      expect(screen.queryByTestId("primitive-library-item-viz-acme-tile")).toBeNull();
    });
  });
});
