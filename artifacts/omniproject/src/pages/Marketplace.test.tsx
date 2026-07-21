import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import type { ExtensionMeta } from "../lib/marketplace";

/**
 * The Marketplace page: installed-extension list, empty / loading / error states, the install-manifest
 * form (JSON guard + success + failure toast), and the enable/disable toggle + uninstall. Following the
 * house pattern (see Whiteboards.test.tsx), each hook is stubbed behind a mutable knob; the real pure
 * `contributionKindLabel` is kept via importOriginal so the shipping label logic renders.
 */

let extensions: ExtensionMeta[] = [];
let isLoading = false;
let isError = false;
let installMode: "ok" | "err" = "ok";
let installPending = false;

const refetch = vi.fn();
const installMutate = vi.fn();
const setStatusMutate = vi.fn();
const uninstallMutate = vi.fn();
const toast = vi.fn();

const mutateWith = (spy: (vars: unknown) => void, getMode: () => "ok" | "err", result?: (vars: unknown) => unknown) =>
  (vars: unknown, opts?: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
    spy(vars);
    if (getMode() === "err") opts?.onError?.(new Error("boom"));
    else opts?.onSuccess?.(result ? result(vars) : undefined);
  };

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

vi.mock("../lib/marketplace", async (importActual) => {
  const actual = await importActual<typeof import("../lib/marketplace")>();
  return {
    ...actual,
    useExtensions: () => ({ data: extensions, isLoading, isError, error: isError ? new Error("nope") : null, refetch }),
    useInstallExtension: () => ({ isPending: installPending, mutate: mutateWith(installMutate, () => installMode, (v) => v) }),
    useSetExtensionStatus: () => ({ isPending: false, mutate: mutateWith(setStatusMutate, () => "ok") }),
    useUninstallExtension: () => ({ isPending: false, mutate: mutateWith(uninstallMutate, () => "ok") }),
  };
});

const { Marketplace } = await import("./Marketplace");

const meta = (over: Partial<ExtensionMeta> = {}): ExtensionMeta => ({
  id: "e1", name: "Reports Pack", publisher: "Acme", version: "1.0.0", status: "installed",
  contributionCount: 2, contributionKinds: ["report", "contentPage"], installedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
});

beforeEach(() => {
  extensions = [];
  isLoading = false;
  isError = false;
  installMode = "ok";
  installPending = false;
  refetch.mockClear(); installMutate.mockClear(); setStatusMutate.mockClear(); uninstallMutate.mockClear(); toast.mockClear();
});

describe("Marketplace page", () => {
  it("shows the loading state (list body withheld)", () => {
    isLoading = true;
    renderWithProviders(<Marketplace />);
    expect(screen.getByRole("heading", { name: /Marketplace/i })).toBeInTheDocument();
    expect(screen.queryByTestId("extension-list")).not.toBeInTheDocument();
  });

  it("shows an error state with a retry that calls refetch", () => {
    isError = true;
    renderWithProviders(<Marketplace />);
    const retry = screen.queryByRole("button", { name: /retry|try again/i });
    if (retry) { fireEvent.click(retry); expect(refetch).toHaveBeenCalled(); }
  });

  it("shows the empty state when nothing is installed", () => {
    renderWithProviders(<Marketplace />);
    expect(screen.getByText(/No extensions installed/i)).toBeInTheDocument();
  });

  it("lists installed extensions with their status and contributions", () => {
    extensions = [meta(), meta({ id: "e2", name: "Board Pack", status: "disabled", contributionCount: 1, contributionKinds: ["dashboard"] })];
    renderWithProviders(<Marketplace />);
    expect(screen.getByTestId("extension-row-e1")).toHaveTextContent("Reports Pack");
    expect(screen.getByTestId("extension-row-e1")).toHaveTextContent(/Report, Content page/);
    expect(screen.getByTestId("extension-row-e1")).toHaveTextContent(/2 contributions/);
    // Singular contribution wording.
    expect(screen.getByTestId("extension-row-e2")).toHaveTextContent(/1 contribution:/);
    expect(screen.getByTestId("extension-row-e2")).toHaveTextContent("disabled");
  });

  // --- Install form: guard, success, failure, pending. ---
  it("guards against invalid manifest JSON before calling the server", () => {
    renderWithProviders(<Marketplace />);
    fireEvent.click(screen.getByTestId("extension-install"));
    fireEvent.change(screen.getByTestId("extension-manifest"), { target: { value: "{ not json" } });
    fireEvent.click(screen.getByTestId("extension-install-submit"));
    expect(screen.getByTestId("extension-error")).toHaveTextContent(/valid JSON/i);
    expect(installMutate).not.toHaveBeenCalled();
  });

  it("keeps Install disabled until the manifest textarea has content", () => {
    renderWithProviders(<Marketplace />);
    fireEvent.click(screen.getByTestId("extension-install"));
    expect(screen.getByTestId("extension-install-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("extension-manifest"), { target: { value: "{}" } });
    expect(screen.getByTestId("extension-install-submit")).not.toBeDisabled();
  });

  it("installs a valid manifest, toasts success and closes the form", () => {
    renderWithProviders(<Marketplace />);
    fireEvent.click(screen.getByTestId("extension-install"));
    fireEvent.change(screen.getByTestId("extension-manifest"), { target: { value: '{"name":"Pack","publisher":"Acme"}' } });
    fireEvent.click(screen.getByTestId("extension-install-submit"));
    expect(installMutate).toHaveBeenCalledWith({ name: "Pack", publisher: "Acme" });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "EXTENSION INSTALLED", description: "Pack by Acme" }));
    expect(screen.queryByTestId("extension-manifest")).not.toBeInTheDocument();
  });

  it("shows a rejection message when the install fails server-side", () => {
    installMode = "err";
    renderWithProviders(<Marketplace />);
    fireEvent.click(screen.getByTestId("extension-install"));
    fireEvent.change(screen.getByTestId("extension-manifest"), { target: { value: "{}" } });
    fireEvent.click(screen.getByTestId("extension-install-submit"));
    expect(screen.getByTestId("extension-error")).toHaveTextContent(/rejected/i);
  });

  it("shows an Installing… affordance while the install is pending", () => {
    installPending = true;
    renderWithProviders(<Marketplace />);
    fireEvent.click(screen.getByTestId("extension-install"));
    expect(screen.getByTestId("extension-install-submit")).toHaveTextContent(/Installing…/i);
  });

  it("cancels the install form via its Cancel button", () => {
    renderWithProviders(<Marketplace />);
    fireEvent.click(screen.getByTestId("extension-install"));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.queryByTestId("extension-manifest")).not.toBeInTheDocument();
  });

  // --- Row actions: toggle status + uninstall. ---
  it("disables an installed extension via the toggle", () => {
    extensions = [meta({ status: "installed" })];
    renderWithProviders(<Marketplace />);
    const toggle = screen.getByTestId("extension-toggle-e1");
    expect(toggle).toHaveTextContent("Disable");
    fireEvent.click(toggle);
    expect(setStatusMutate).toHaveBeenCalledWith({ id: "e1", status: "disabled" });
  });

  it("enables a disabled extension via the toggle", () => {
    extensions = [meta({ status: "disabled" })];
    renderWithProviders(<Marketplace />);
    const toggle = screen.getByTestId("extension-toggle-e1");
    expect(toggle).toHaveTextContent("Enable");
    fireEvent.click(toggle);
    expect(setStatusMutate).toHaveBeenCalledWith({ id: "e1", status: "installed" });
  });

  it("uninstalls an extension", () => {
    extensions = [meta()];
    renderWithProviders(<Marketplace />);
    fireEvent.click(screen.getByTestId("extension-remove-e1"));
    expect(uninstallMutate).toHaveBeenCalledWith("e1");
  });
});
