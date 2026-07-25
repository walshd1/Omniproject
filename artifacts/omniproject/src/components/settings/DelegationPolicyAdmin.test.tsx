import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DelegationPolicyAdmin } from "./DelegationPolicyAdmin";

/**
 * DelegationPolicyAdmin — the governance dial. We mock the policy hooks and assert it renders the per-area
 * pickers, enables Save only on change, and sends the edited policy.
 */
const setPolicy = vi.fn();
let policyData: unknown = {
  policy: { ruleset: "org", settings: "org", methodologyComposition: "org" },
  areas: ["ruleset", "settings", "methodologyComposition"],
  levels: ["org", "programme", "project", "user"],
};

vi.mock("../../lib/delegation-policy-api", () => ({
  useDelegationPolicy: () => ({ data: policyData }),
  useSetDelegationPolicy: () => ({ mutate: setPolicy, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const wrap = (node: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};

describe("DelegationPolicyAdmin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a picker per area with the full level vocabulary", () => {
    wrap(<DelegationPolicyAdmin />);
    const sel = screen.getByLabelText("Local variation for Methodology") as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(["org", "programme", "project", "user"]);
  });

  it("Save is disabled until a level changes, then sends the edited policy", async () => {
    wrap(<DelegationPolicyAdmin />);
    expect(screen.getByTestId("delegation-policy-save")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Local variation for Methodology"), { target: { value: "programme" } });
    const save = screen.getByTestId("delegation-policy-save");
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(setPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ methodologyComposition: "programme", ruleset: "org", settings: "org" }),
      expect.any(Object),
    ));
  });

  it("renders nothing until the policy loads", () => {
    policyData = undefined;
    const { container } = wrap(<DelegationPolicyAdmin />);
    expect(container).toBeEmptyDOMElement();
    policyData = { policy: { ruleset: "org", settings: "org", methodologyComposition: "org" }, areas: ["ruleset", "settings", "methodologyComposition"], levels: ["org", "programme", "project", "user"] };
  });
});
