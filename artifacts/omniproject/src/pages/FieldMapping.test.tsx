import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import type { SupersetField, ResolvedMapping } from "../lib/field-mapping";

/**
 * FieldMapping is the admin translation page: it renders the LIVE superset (loading/error/empty/table
 * with its per-field `limits()` blurb), lets an admin compose UI → superset links and save them through
 * the one importer (success + both error branches), and previews the effective mapping for a project
 * (homeless fields, the string-vs-triple field ref, inherited validation). Every seam is stubbed behind
 * a mutable module-level knob (the house pattern — see Whiteboards.test.tsx); `refFromSuperset` is kept
 * REAL (importOriginal) so the saved triple is the shipping one.
 */

// --- Per-test knobs (reset in beforeEach), closed over by the vi.mock factories below. ---
let supersetData: SupersetField[] | undefined = [];
let supersetLoading = false;
let supersetError = false;
const supersetRefetch = vi.fn();

let importPending = false;
let saveMode: "ok" | "err" = "ok";
let saveErr: unknown = new Error("import boom");
const mutateAsync = vi.fn(async () => {
  if (saveMode === "err") throw saveErr;
  return {};
});

let previewData: ResolvedMapping | undefined = undefined;
let previewLoading = false;
let previewError = false;
const previewRefetch = vi.fn();

const toast = vi.fn();

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

vi.mock("../lib/defs", () => ({
  useImportDef: () => ({ mutateAsync, isPending: importPending }),
}));

// Keep the real `refFromSuperset` (the triple builder under test); only the two query hooks are stubbed.
vi.mock("../lib/field-mapping", async (importActual) => {
  const actual = await importActual<typeof import("../lib/field-mapping")>();
  return {
    ...actual,
    useLiveSuperset: () => ({
      data: supersetData,
      isLoading: supersetLoading,
      isError: supersetError,
      error: supersetError ? new Error("superset down") : undefined,
      refetch: supersetRefetch,
    }),
    useResolvedMapping: () => ({
      data: previewData,
      isLoading: previewLoading,
      isError: previewError,
      error: previewError ? new Error("mapping down") : undefined,
      refetch: previewRefetch,
    }),
  };
});

const { FieldMapping } = await import("./FieldMapping");

function sfield(over: Partial<SupersetField> = {}): SupersetField {
  return {
    id: "f1",
    canonicalKey: "summary",
    label: "Summary",
    broker: "atlassian",
    system: "jira",
    nativeField: "fields.summary",
    type: "string",
    canonical: true,
    ...over,
  };
}

beforeEach(() => {
  supersetData = [];
  supersetLoading = false;
  supersetError = false;
  importPending = false;
  saveMode = "ok";
  saveErr = new Error("import boom");
  previewData = undefined;
  previewLoading = false;
  previewError = false;
  mutateAsync.mockClear();
  supersetRefetch.mockClear();
  previewRefetch.mockClear();
  toast.mockClear();
});

describe("FieldMapping — superset surface", () => {
  it("renders the loading placeholder while the superset is fetching", () => {
    supersetLoading = true;
    supersetData = undefined;
    renderWithProviders(<FieldMapping />);
    expect(screen.getByRole("heading", { level: 1, name: /field mapping/i })).toBeInTheDocument();
    // DataState renders LoadingState → the table is not mounted.
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("surfaces an error with a Retry that refetches", () => {
    supersetError = true;
    supersetData = undefined;
    renderWithProviders(<FieldMapping />);
    expect(screen.getByRole("alert")).toHaveTextContent(/superset down/i);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(supersetRefetch).toHaveBeenCalled();
  });

  it("shows the no-backend note when nothing is mappable", () => {
    supersetData = [];
    renderWithProviders(<FieldMapping />);
    expect(screen.getByText(/no backend is connected/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /available fields \(0\)/i })).toBeInTheDocument();
  });

  it("renders every advertised-limit variant in the field table", () => {
    supersetData = [
      sfield({ id: "len", label: "Title", maxLength: 120 }),
      sfield({ id: "prec", label: "Estimate", type: "number", precision: 2 }),
      sfield({ id: "opt", label: "Status", options: ["a", "b", "c"] }),
      sfield({ id: "null", label: "Notes", nullable: true }),
      sfield({ id: "none", label: "Bare", canonical: false, canonicalKey: "custom.x" }),
    ];
    renderWithProviders(<FieldMapping />);
    expect(screen.getByText("≤ 120 chars")).toBeInTheDocument();
    expect(screen.getByText("2 dp")).toBeInTheDocument();
    expect(screen.getByText("one of 3")).toBeInTheDocument();
    expect(screen.getByText("optional")).toBeInTheDocument();
    // limits() with no constraints → the em-dash placeholder; custom canonical key → "(custom)" suffix.
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/custom\.x \(custom\)/)).toBeInTheDocument();
  });

  it("filters the visible rows by the filter box", () => {
    supersetData = [
      sfield({ id: "a", label: "Summary", nativeField: "fields.summary" }),
      sfield({ id: "b", label: "Priority", canonicalKey: "priority", nativeField: "fields.priority" }),
    ];
    renderWithProviders(<FieldMapping />);
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Priority")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Filter…"), { target: { value: "priority" } });
    expect(screen.queryByText("Summary")).toBeNull();
    expect(screen.getByText("Priority")).toBeInTheDocument();
  });
});

describe("FieldMapping — compose + save", () => {
  it("picks a field then adds and removes a link", () => {
    supersetData = [sfield({ id: "f1", label: "Summary" })];
    renderWithProviders(<FieldMapping />);
    // Before picking, the picked-field slot is the placeholder.
    expect(screen.getByText("— pick above —")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(screen.getByText("Summary ← jira:fields.summary")).toBeInTheDocument();

    // Add link is gated on a UI name; type one, then add.
    const add = screen.getByRole("button", { name: /add link/i });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("e.g. Title"), { target: { value: "Title" } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    expect(screen.getByText("Title")).toBeInTheDocument();

    // Remove it via the trash button (the only icon-button in the entries list).
    const removeBtn = screen.getByRole("button", { name: "" });
    fireEvent.click(removeBtn);
    expect(screen.queryByText(/← summary ←/i)).toBeNull();
  });

  it("de-duplicates a link by UI name (re-adding replaces)", () => {
    supersetData = [
      sfield({ id: "f1", label: "Summary", nativeField: "fields.summary" }),
      sfield({ id: "f2", label: "Priority", canonicalKey: "priority", nativeField: "fields.priority" }),
    ];
    renderWithProviders(<FieldMapping />);
    const picks = screen.getAllByRole("button", { name: "Pick" });
    fireEvent.click(picks[0]);
    fireEvent.change(screen.getByPlaceholderText("e.g. Title"), { target: { value: "Title" } });
    fireEvent.click(screen.getByRole("button", { name: /add link/i }));
    // Re-pick a different field for the same UI name → the entry is replaced, not duplicated.
    fireEvent.click(screen.getAllByRole("button", { name: "Pick" })[1]);
    fireEvent.change(screen.getByPlaceholderText("e.g. Title"), { target: { value: "Title" } });
    fireEvent.click(screen.getByRole("button", { name: /add link/i }));
    const listItems = screen.getAllByText("Title");
    expect(listItems).toHaveLength(1);
    // The single entry now references the second field (priority), scoped to the entries list.
    const list = screen.getByRole("list");
    expect(within(list).getByText(/fields\.priority/)).toBeInTheDocument();
    expect(within(list).queryByText(/fields\.summary/)).toBeNull();
  });

  it("keeps Save disabled until there is at least one link", () => {
    supersetData = [sfield()];
    renderWithProviders(<FieldMapping />);
    expect(screen.getByRole("button", { name: /save mapping/i })).toBeDisabled();
  });

  it("disables Save while the import is pending", () => {
    importPending = true;
    supersetData = [sfield()];
    renderWithProviders(<FieldMapping />);
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Title"), { target: { value: "Title" } });
    fireEvent.click(screen.getByRole("button", { name: /add link/i }));
    expect(screen.getByRole("button", { name: /save mapping/i })).toBeDisabled();
  });

  function composeOne() {
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Title"), { target: { value: "Title" } });
    fireEvent.click(screen.getByRole("button", { name: /add link/i }));
  }

  it("saves through the importer with the built triple and toasts success", async () => {
    supersetData = [sfield({ id: "f1", label: "Summary" })];
    renderWithProviders(<FieldMapping />);
    composeOne();
    fireEvent.click(screen.getByRole("button", { name: /save mapping/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Mapping saved" })));
    expect(mutateAsync).toHaveBeenCalledWith({
      kind: "mapping",
      storage: "org",
      name: "Mapping: issue",
      payload: {
        id: "issue",
        fields: { Title: { broker: "atlassian", backend: "jira", field: "fields.summary", superset: "summary" } },
      },
    });
    // Entries cleared on success.
    await waitFor(() => expect(screen.queryByText(/← summary ←/i)).toBeNull());
  });

  it("early-returns from save when the slot is blank", () => {
    supersetData = [sfield()];
    renderWithProviders(<FieldMapping />);
    composeOne();
    fireEvent.change(screen.getByLabelText(/slot/i), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: /save mapping/i }));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("toasts the error message when the import fails", async () => {
    saveMode = "err";
    saveErr = new Error("scope denied");
    supersetData = [sfield()];
    renderWithProviders(<FieldMapping />);
    composeOne();
    fireEvent.click(screen.getByRole("button", { name: /save mapping/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", title: "Could not save", description: "scope denied" }),
      ),
    );
  });

  it("falls back to a generic message when the import rejects with a non-Error", async () => {
    saveMode = "err";
    saveErr = "weird";
    supersetData = [sfield()];
    renderWithProviders(<FieldMapping />);
    composeOne();
    fireEvent.click(screen.getByRole("button", { name: /save mapping/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", title: "Could not save", description: "Import failed" }),
      ),
    );
  });
});

describe("FieldMapping — effective mapping preview", () => {
  it("shows no preview surface until a project id is entered", () => {
    renderWithProviders(<FieldMapping />);
    expect(screen.getByRole("heading", { name: /effective mapping/i })).toBeInTheDocument();
    // No project id → the DataState/preview block is not rendered.
    expect(screen.queryByText(/^Fields$/)).toBeNull();
  });

  it("renders the loading state while the preview fetches", () => {
    previewLoading = true;
    renderWithProviders(<FieldMapping />);
    fireEvent.change(screen.getByPlaceholderText("project id"), { target: { value: "p1" } });
    // Loading → no fields block yet, but no error alert either.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces a preview error with a Retry", () => {
    previewError = true;
    renderWithProviders(<FieldMapping />);
    fireEvent.change(screen.getByPlaceholderText("project id"), { target: { value: "p1" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/mapping down/i);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(previewRefetch).toHaveBeenCalled();
  });

  it("renders homeless fields, both field-ref shapes and inherited validation", () => {
    previewData = {
      id: "issue",
      homeless: ["Assignee", "Reporter"],
      fields: {
        Title: { field: "fields.summary", superset: "summary", backend: "jira" },
        Legacy: "raw-native",
        NoHome: { field: "fields.orphan" },
      },
      validation: [
        { field: "Title", required: true, max: 120, options: ["a", "b"] },
        { field: "Desc" },
      ],
    };
    renderWithProviders(<FieldMapping />);
    fireEvent.change(screen.getByPlaceholderText("project id"), { target: { value: "p1" } });

    // Homeless banner.
    expect(screen.getByText(/homeless fields/i)).toHaveTextContent("Assignee, Reporter");
    // String ref renders bare; object ref uses superset @ backend; missing backend → "—".
    expect(screen.getByText(/raw-native/)).toBeInTheDocument();
    expect(screen.getByText(/summary @ jira/)).toBeInTheDocument();
    expect(screen.getByText(/fields\.orphan @ —/)).toBeInTheDocument();
    // Validation: the populated row and the empty (no-constraint) row.
    expect(screen.getByText(/Title:/)).toHaveTextContent("required, max 120, one of [a, b]");
    expect(screen.getByText(/Desc:/)).toBeInTheDocument();
  });

  it("omits the homeless banner and validation block when both are empty", () => {
    previewData = {
      id: "issue",
      homeless: [],
      fields: { Title: "fields.summary" },
      validation: [],
    };
    renderWithProviders(<FieldMapping />);
    fireEvent.change(screen.getByPlaceholderText("project id"), { target: { value: "p1" } });
    expect(screen.queryByText(/homeless fields/i)).toBeNull();
    expect(screen.queryByText(/inherited validation/i)).toBeNull();
    expect(screen.getByText(/fields\.summary/)).toBeInTheDocument();
  });
});
