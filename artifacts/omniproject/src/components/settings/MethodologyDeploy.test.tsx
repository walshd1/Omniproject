import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MethodologyDeploy } from "./MethodologyDeploy";

/**
 * MethodologyDeploy — the one-click "turn a methodology on" affordance. We mock the preview + deploy hooks and
 * assert the pick → preview-summary → deploy orchestration and that a picked methodology is what gets deployed.
 */
const deployMutate = vi.fn();
let previewData: unknown = undefined;

vi.mock("../../lib/methodology-composition-api", () => ({
  useMethodologyDeploymentPreview: () => ({ data: previewData }),
  useDeployMethodology: () => ({ mutate: deployMutate, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const wrap = (node: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};
const METHODS = [{ id: "gtd", label: "GTD" }, { id: "scrum", label: "Scrum" }];

describe("MethodologyDeploy", () => {
  beforeEach(() => { vi.clearAllMocks(); previewData = undefined; });

  it("Deploy is disabled until a methodology is picked", () => {
    wrap(<MethodologyDeploy methodologies={METHODS} />);
    expect(screen.getByTestId("methodology-deploy-apply")).toBeDisabled();
  });

  it("shows the preview summary for the picked methodology", () => {
    previewData = {
      methodologyId: "gtd", label: "GTD", compositionItemIds: [], ruleset: { id: "gtd" },
      invariants: [{ id: "x", message: "m" }],
      nomenclature: { states: ["inbox", "next"], ceremonies: [], statuses: [], priorities: [] },
      settings: { fxRatePolicy: "periodClose" },
      summary: { views: 0, reports: 1, screens: 2, invariants: 1, hasRuleset: true, settings: 1 },
    };
    wrap(<MethodologyDeploy methodologies={METHODS} />);
    fireEvent.change(screen.getByLabelText("Methodology to deploy"), { target: { value: "gtd" } });
    const preview = screen.getByTestId("methodology-deploy-preview");
    expect(preview).toHaveTextContent(/2\s*screens/);
    expect(preview).toHaveTextContent(/gtd\s*ruleset/);
    expect(preview).toHaveTextContent(/1\s*preset setting/);
    expect(preview).toHaveTextContent("inbox · next");
  });

  it("deploys the picked methodology", async () => {
    deployMutate.mockImplementation((_args, opts) => opts?.onSuccess?.({ appliedRuleset: "gtd", appliedSettings: [] }));
    wrap(<MethodologyDeploy methodologies={METHODS} />);
    fireEvent.change(screen.getByLabelText("Methodology to deploy"), { target: { value: "scrum" } });
    fireEvent.click(screen.getByTestId("methodology-deploy-apply"));
    await waitFor(() => expect(deployMutate).toHaveBeenCalledWith({ methodologyId: "scrum" }, expect.any(Object)));
  });
});
