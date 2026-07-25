import { describe, it, expect, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { rulesetAccountingKey } from "../../lib/ruleset-accounting";
import { Toaster } from "../ui/toaster";
import { RulesetAccountingAdmin } from "./RulesetAccountingAdmin";

/** The accounting-policy governance section: seeds from GET /api/admin/ruleset/accounting, edits, PUTs the same. */
function seed(accounting: unknown, missingAccounts: string[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(rulesetAccountingKey, { accounting, missingAccounts });
  return qc;
}

describe("RulesetAccountingAdmin", () => {
  afterEach(() => resetFetchMock());

  it("seeds the editor from the ruleset accounting catalogue", async () => {
    renderWithProviders(<RulesetAccountingAdmin />, {
      client: seed({ accounts: { depreciationExpense: "6800", accumulatedDepreciation: "1590" }, decliningBalanceFactor: 1.5, defaultDepreciationMethod: "declining_balance" }),
    });
    await waitFor(() => expect(screen.getByTestId("acct-depreciationExpense")).toHaveValue("6800"));
    expect(screen.getByTestId("acct-assetCost")).toHaveValue(""); // unset code stays blank
    expect(screen.getByTestId("acct-db-factor")).toHaveValue(1.5);
    expect(screen.getByTestId("acct-method")).toHaveValue("declining_balance");
  });

  it("saves via PUT /api/admin/ruleset/accounting", async () => {
    mockFetchRouter({ "/api/admin/ruleset/accounting": { ok: true, body: { accounting: {}, missingAccounts: [] } } });
    renderWithProviders(<><RulesetAccountingAdmin /><Toaster /></>, {
      client: seed({ accounts: { depreciationExpense: "6800" }, decliningBalanceFactor: 2, defaultDepreciationMethod: "straight_line" }),
    });
    await waitFor(() => expect(screen.getByTestId("acct-depreciationExpense")).toHaveValue("6800"));
    fireEvent.change(screen.getByTestId("acct-assetCost"), { target: { value: "1500" } });
    fireEvent.click(screen.getByTestId("acct-save"));
    expect(await screen.findByText("ACCOUNTING POLICY SAVED")).toBeInTheDocument();
  });

  it("disables save on an invalid GL account code or out-of-range factor", async () => {
    renderWithProviders(<RulesetAccountingAdmin />, {
      client: seed({ accounts: { depreciationExpense: "6800" }, decliningBalanceFactor: 2, defaultDepreciationMethod: "straight_line" }),
    });
    await waitFor(() => expect(screen.getByTestId("acct-depreciationExpense")).toHaveValue("6800"));
    fireEvent.change(screen.getByTestId("acct-assetCost"), { target: { value: "has space" } });
    expect(screen.getByTestId("acct-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("acct-assetCost"), { target: { value: "1500" } });
    fireEvent.change(screen.getByTestId("acct-db-factor"), { target: { value: "5" } });
    expect(screen.getByTestId("acct-save")).toBeDisabled();
  });
});
