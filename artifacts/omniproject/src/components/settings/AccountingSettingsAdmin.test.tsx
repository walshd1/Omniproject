import { describe, it, expect, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { accountingOrgKey } from "../../lib/accounting-settings";
import { Toaster } from "../ui/toaster";
import { AccountingSettingsAdmin } from "./AccountingSettingsAdmin";

/** The accounting-policy admin card: seeds from GET /api/accounting (the org config def), edits, PUT /api/accounting. */
function seed(accounting: unknown): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(accountingOrgKey, { accounting });
  return qc;
}

describe("AccountingSettingsAdmin", () => {
  afterEach(() => resetFetchMock());

  it("seeds the editor from the org config def", async () => {
    renderWithProviders(<AccountingSettingsAdmin />, {
      client: seed({ accounts: { depreciationExpense: "6800", accumulatedDepreciation: "1590" }, decliningBalanceFactor: 1.5, defaultDepreciationMethod: "declining_balance" }),
    });
    await waitFor(() => expect(screen.getByTestId("acct-depreciationExpense")).toHaveValue("6800"));
    expect(screen.getByTestId("acct-accumulatedDepreciation")).toHaveValue("1590");
    expect(screen.getByTestId("acct-assetCost")).toHaveValue(""); // unset code stays blank
    expect(screen.getByTestId("acct-db-factor")).toHaveValue(1.5);
    expect(screen.getByTestId("acct-method")).toHaveValue("declining_balance");
  });

  it("saves an edited accounting policy via PUT /api/accounting", async () => {
    mockFetchRouter({ "/api/accounting": { ok: true, body: { accounting: {} } } });
    renderWithProviders(<><AccountingSettingsAdmin /><Toaster /></>, {
      client: seed({ accounts: { depreciationExpense: "6800" }, decliningBalanceFactor: 2, defaultDepreciationMethod: "straight_line" }),
    });
    await waitFor(() => expect(screen.getByTestId("acct-depreciationExpense")).toHaveValue("6800"));
    fireEvent.change(screen.getByTestId("acct-assetCost"), { target: { value: "1500" } });
    fireEvent.change(screen.getByTestId("acct-db-factor"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByTestId("acct-save"));
    expect(await screen.findByText("ACCOUNTING POLICY SAVED")).toBeInTheDocument();
  });

  it("disables save on an invalid GL account code", async () => {
    renderWithProviders(<AccountingSettingsAdmin />, {
      client: seed({ accounts: { depreciationExpense: "6800" }, decliningBalanceFactor: 2, defaultDepreciationMethod: "straight_line" }),
    });
    await waitFor(() => expect(screen.getByTestId("acct-depreciationExpense")).toHaveValue("6800"));
    fireEvent.change(screen.getByTestId("acct-assetCost"), { target: { value: "has space" } });
    expect(screen.getByTestId("acct-save")).toBeDisabled();
  });

  it("disables save when the declining-balance factor is out of range", async () => {
    renderWithProviders(<AccountingSettingsAdmin />, {
      client: seed({ accounts: {}, decliningBalanceFactor: 2, defaultDepreciationMethod: "straight_line" }),
    });
    await waitFor(() => expect(screen.getByTestId("acct-db-factor")).toHaveValue(2));
    fireEvent.change(screen.getByTestId("acct-db-factor"), { target: { value: "5" } });
    expect(screen.getByTestId("acct-save")).toBeDisabled();
  });
});
