import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { studioStatusKey, type PrimitiveStudioResult } from "./studio";
import { Studio } from "./Studio";

/**
 * Primitive Studio page: the AI authoring companion. Describe → generate (a validated candidate
 * bundle) → preview + verdict → refine/regenerate → save into a scoped encrypted store. These
 * tests drive the generate/import mutations through the fetch router and cover every visible state
 * (unavailable notice, verdict, previewable vs describe-only, JSON dump), the refine iterate
 * payload, image attach/clear, the pending affordances, and the success/error toasts.
 */

// The chart preview is a heavy recharts wrapper; stub it so a previewable primitive is observable
// without a real SVG render (coverage here is Studio's own branches, not ChartView's).
vi.mock("../../components/charts/ChartView", () => ({
  ChartView: (props: { type: string }) => <div data-testid="mock-chartview">{props.type}</div>,
}));

/** A FileReader stand-in whose `readAsDataURL` synchronously fires `onload` with a canned result. */
function stubFileReader(res: string) {
  class MockFileReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    readAsDataURL() {
      this.result = res;
      this.onload?.();
    }
  }
  vi.stubGlobal("FileReader", MockFileReader);
}

/** A generate result fixture (the proposed submission + the deterministic test outcome). */
function result(over: { [K in keyof PrimitiveStudioResult]?: PrimitiveStudioResult[K] | undefined } = {}): PrimitiveStudioResult {
  return {
    submission: {
      kind: "primitive",
      name: "Grouped columns",
      publisher: "acme",
      version: "1.0.0",
      description: "planned vs actual",
      tags: ["finance"],
      payload: { foo: "bar" },
    },
    valid: true,
    errors: [],
    def: { chartType: "bar", category: "chart", params: [{ label: "Metric" }] } as unknown as PrimitiveStudioResult["def"],
    ...over,
  } as PrimitiveStudioResult;
}

function seed(status?: { available: boolean }): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } },
  });
  if (status) qc.setQueryData(studioStatusKey, status);
  return qc;
}

/** Render available, type a description, and generate → resolve with `res`; returns the recorded calls. */
async function generate(res: PrimitiveStudioResult, extra: Record<string, { ok: boolean; body?: unknown }> = {}) {
  const calls = mockFetchRouter({ "/api/studio/primitive": { ok: true, body: { result: res } }, ...extra });
  renderWithProviders(<Studio />, { client: seed({ available: true }) });
  fireEvent.change(screen.getByTestId("studio-description"), { target: { value: "a grouped column chart" } });
  fireEvent.click(screen.getByTestId("studio-generate"));
  await screen.findByTestId("studio-result");
  return calls;
}

afterEach(() => {
  resetFetchMock();
  vi.unstubAllGlobals();
});

describe("Studio page", () => {
  it("renders the title and description field, with no result block yet", () => {
    renderWithProviders(<Studio />, { client: seed({ available: true }) });
    expect(screen.getByRole("heading", { level: 1, name: /primitive studio/i })).toBeInTheDocument();
    expect(screen.getByTestId("studio-description")).toBeInTheDocument();
    expect(screen.queryByTestId("studio-result")).not.toBeInTheDocument();
  });

  it("warns when no AI provider is configured / authoring is off", () => {
    renderWithProviders(<Studio />, { client: seed({ available: false }) });
    expect(screen.getByTestId("studio-unavailable")).toBeInTheDocument();
  });

  it("shows no unavailable notice before the status query has resolved", () => {
    renderWithProviders(<Studio />, { client: seed() });
    expect(screen.queryByTestId("studio-unavailable")).not.toBeInTheDocument();
  });

  it("disables Generate until a non-empty description is entered", () => {
    renderWithProviders(<Studio />, { client: seed({ available: true }) });
    expect(screen.getByTestId("studio-generate")).toBeDisabled();
    fireEvent.change(screen.getByTestId("studio-description"), { target: { value: "  " } });
    expect(screen.getByTestId("studio-generate")).toBeDisabled();
    fireEvent.change(screen.getByTestId("studio-description"), { target: { value: "a chart" } });
    expect(screen.getByTestId("studio-generate")).not.toBeDisabled();
  });

  it("generates a valid primitive: verdict, chart preview, and the bundle JSON", async () => {
    await generate(result());
    expect(screen.getByTestId("studio-valid")).toBeInTheDocument();
    expect(screen.getByTestId("mock-chartview")).toHaveTextContent("bar");
    expect(screen.getByTestId("studio-json")).toHaveTextContent(/"name": "Grouped columns"/);
  });

  it("previews every chart type demoSpec can draw", async () => {
    for (const type of ["line", "area", "pie", "donut"] as const) {
      const { unmount } = renderWithProviders(<Studio />, { client: seed({ available: true }) });
      mockFetchRouter({ "/api/studio/primitive": { ok: true, body: { result: result({ def: { chartType: type, category: "chart", params: [] } as unknown as PrimitiveStudioResult["def"] }) } } });
      fireEvent.change(screen.getByTestId("studio-description"), { target: { value: "x" } });
      fireEvent.click(screen.getByTestId("studio-generate"));
      expect(await screen.findByTestId("mock-chartview")).toHaveTextContent(type);
      unmount();
      resetFetchMock();
    }
  });

  it("lists the validation errors when the candidate is not valid", async () => {
    await generate(result({ valid: false, errors: ["chartType is required", "params is empty"] }));
    const errors = screen.getByTestId("studio-errors");
    expect(errors).toHaveTextContent(/not valid yet/i);
    expect(errors).toHaveTextContent("chartType is required");
    expect(errors).toHaveTextContent("params is empty");
  });

  it("describes a non-renderable primitive (single input) instead of a preview", async () => {
    await generate(result({ def: { chartType: "scatter", category: "diagram", params: [{ label: "Nodes" }] } as unknown as PrimitiveStudioResult["def"] }));
    expect(screen.queryByTestId("mock-chartview")).not.toBeInTheDocument();
    expect(screen.getByTestId("studio-preview")).toHaveTextContent(/A diagram primitive with 1 input: Nodes\./);
  });

  it("pluralises the input count for a multi-param non-chart primitive", async () => {
    await generate(result({ def: { chartType: undefined, category: "form", params: [{ label: "A" }, { label: "B" }] } as unknown as PrimitiveStudioResult["def"] }));
    expect(screen.getByTestId("studio-preview")).toHaveTextContent(/A form primitive with 2 inputs: A, B\./);
  });

  it("shows the fix-errors hint when the result carries no def", async () => {
    await generate(result({ valid: false, errors: ["broken"], def: undefined }));
    expect(screen.getByTestId("studio-preview")).toHaveTextContent(/No renderable preview — fix the validation errors first\./);
  });

  it("refine re-runs with the feedback and the previous payload, then clears the feedback box", async () => {
    const calls = await generate(result());
    fireEvent.change(screen.getByTestId("studio-feedback"), { target: { value: "make the bars horizontal" } });
    fireEvent.click(screen.getByTestId("studio-refine"));
    await waitFor(() => {
      const posts = calls.filter((c) => (c.init?.method ?? "GET").toUpperCase() === "POST" && c.url.includes("/api/studio/primitive"));
      const last = posts[posts.length - 1]!;
      const body = JSON.parse(String(last.init?.body));
      expect(body.feedback).toBe("make the bars horizontal");
      expect(body.previous).toEqual({ foo: "bar" });
    });
    expect(screen.getByTestId("studio-feedback")).toHaveValue("");
  });

  it("toasts on a generation failure", async () => {
    mockFetchRouter({ "/api/studio/primitive": { ok: false } });
    renderWithProviders(<Studio />, { client: seed({ available: true }) });
    const toast = renderHook(() => useToast());
    fireEvent.change(screen.getByTestId("studio-description"), { target: { value: "a chart" } });
    fireEvent.click(screen.getByTestId("studio-generate"));
    await waitFor(() => expect(toast.result.current.toasts[0]?.title).toBe("GENERATION FAILED"));
    expect(screen.queryByTestId("studio-result")).not.toBeInTheDocument();
  });

  it("saves to my private area and toasts success with the store label", async () => {
    const calls = await generate(result(), { "/api/defs": { ok: true, body: { id: "d1", name: "Grouped columns" } } });
    const toast = renderHook(() => useToast());
    fireEvent.click(screen.getByTestId("studio-submit"));
    await waitFor(() => expect(toast.result.current.toasts[0]?.title).toBe("SAVED"));
    expect(toast.result.current.toasts[0]?.description).toMatch(/Grouped columns → my private area/);
    const post = calls.find((c) => c.url.includes("/api/defs") && (c.init?.method ?? "GET").toUpperCase() === "POST")!;
    const body = JSON.parse(String(post.init?.body));
    expect(body).toMatchObject({ kind: "primitive", storage: "user", name: "Grouped columns", payload: { foo: "bar" } });
  });

  it("saves org-wide when the storage target is switched", async () => {
    const calls = await generate(result(), { "/api/defs": { ok: true, body: { id: "d1", name: "Grouped columns" } } });
    const toast = renderHook(() => useToast());
    fireEvent.change(screen.getByTestId("studio-storage"), { target: { value: "org" } });
    fireEvent.click(screen.getByTestId("studio-submit"));
    await waitFor(() => expect(toast.result.current.toasts[0]?.description).toMatch(/org-wide/));
    const post = calls.find((c) => c.url.includes("/api/defs") && (c.init?.method ?? "GET").toUpperCase() === "POST")!;
    expect(JSON.parse(String(post.init?.body)).storage).toBe("org");
  });

  it("toasts when the save is rejected (importer off / insufficient access)", async () => {
    await generate(result(), { "/api/defs": { ok: false } });
    const toast = renderHook(() => useToast());
    fireEvent.click(screen.getByTestId("studio-submit"));
    await waitFor(() => expect(toast.result.current.toasts[0]?.title).toBe("SAVE FAILED"));
  });

  it("keeps the save button disabled for an invalid candidate", async () => {
    await generate(result({ valid: false, errors: ["nope"] }));
    expect(screen.getByTestId("studio-submit")).toBeDisabled();
  });

  it("attaches a picked image to the request, shows the chip, and clears it", async () => {
    stubFileReader("data:image/png;base64,QUJD");
    const calls = mockFetchRouter({ "/api/studio/primitive": { ok: true, body: { result: result() } } });
    renderWithProviders(<Studio />, { client: seed({ available: true }) });
    fireEvent.change(screen.getByTestId("studio-image-input"), { target: { files: [{ name: "sketch.png" }] } });
    expect(await screen.findByTestId("studio-image-chip")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("studio-description"), { target: { value: "match this sketch" } });
    fireEvent.click(screen.getByTestId("studio-generate"));
    await screen.findByTestId("studio-result");
    const post = calls.find((c) => c.url.includes("/api/studio/primitive"))!;
    expect(JSON.parse(String(post.init?.body)).image).toEqual({ mime: "image/png", dataBase64: "QUJD" });

    fireEvent.click(screen.getByTestId("studio-image-remove"));
    expect(screen.queryByTestId("studio-image-chip")).not.toBeInTheDocument();
  });

  it("ignores an unreadable image (no data URL match)", () => {
    stubFileReader("not-a-data-url");
    renderWithProviders(<Studio />, { client: seed({ available: true }) });
    fireEvent.change(screen.getByTestId("studio-image-input"), { target: { files: [{ name: "x.bin" }] } });
    expect(screen.queryByTestId("studio-image-chip")).not.toBeInTheDocument();
  });

  it("ignores an empty file selection", () => {
    renderWithProviders(<Studio />, { client: seed({ available: true }) });
    fireEvent.change(screen.getByTestId("studio-image-input"), { target: { files: [] } });
    expect(screen.queryByTestId("studio-image-chip")).not.toBeInTheDocument();
  });

  it("shows the pending affordances while a (re)generation is in flight", async () => {
    // A generate that never resolves keeps the mutation pending → Generate reads "Generating…"
    // and both the generate and refine buttons are disabled.
    await generate(result());
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    fireEvent.change(screen.getByTestId("studio-feedback"), { target: { value: "tweak it" } });
    fireEvent.click(screen.getByTestId("studio-refine"));
    await waitFor(() => expect(screen.getByTestId("studio-generate")).toHaveTextContent(/Generating/i));
    expect(screen.getByTestId("studio-generate")).toBeDisabled();
    expect(screen.getByTestId("studio-refine")).toBeDisabled();
  });
});
