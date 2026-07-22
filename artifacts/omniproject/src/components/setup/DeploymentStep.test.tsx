import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DeploymentStep } from "./DeploymentStep";

/**
 * "Pick your deployment type" — choose an archetype, answer a couple of questions, apply → the org lands on a
 * known-good setup; the active deployment's pickable settings (broker/backend) stay re-pickable. We mock the
 * network-backed hooks and assert the pick → answer → apply orchestration and the broker re-pick.
 */
const setDeployment = vi.fn();
let active: { deploymentType: string | null; settings?: unknown[]; answers?: Record<string, string> } = { deploymentType: null };

vi.mock("../../lib/deployment", () => ({
  useDeploymentTypes: () => ({ data: { deploymentTypes: [
    { id: "solo-selfhost", label: "Solo self-hoster", description: "One person, your own box.", order: 10,
      questions: [{ id: "idp", label: "Use an IdP?", options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }], default: "no" }], setup: {} },
  ] } }),
  useActiveDeployment: () => ({ data: active }),
  useSetDeployment: () => ({ mutateAsync: setDeployment, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const wrap = (node: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};

describe("DeploymentStep", () => {
  beforeEach(() => { vi.clearAllMocks(); active = { deploymentType: null }; setDeployment.mockResolvedValue({}); });

  it("pick → answer → apply sends the deployment type + answers", async () => {
    wrap(<DeploymentStep isAdmin />);
    fireEvent.click(screen.getByTestId("deployment-pick-solo-selfhost"));
    // The question renders; change the answer, then apply.
    fireEvent.change(screen.getByLabelText("Use an IdP?"), { target: { value: "yes" } });
    fireEvent.click(screen.getByTestId("deployment-apply"));
    await waitFor(() => expect(setDeployment).toHaveBeenCalledWith({ deploymentType: "solo-selfhost", answers: { idp: "yes" } }));
  });

  it("shows the active deployment and lets an admin re-pick a pickable setting (broker)", async () => {
    active = {
      deploymentType: "solo-selfhost", answers: { idp: "no" },
      settings: [{ key: "broker", label: "Broker", pickable: true, options: ["builtin:omnistore", "builtin:postgres"], value: "builtin:omnistore" }],
    };
    wrap(<DeploymentStep isAdmin />);
    expect(screen.getByTestId("deployment-active")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Broker"), { target: { value: "builtin:postgres" } });
    await waitFor(() => expect(setDeployment).toHaveBeenCalledWith(expect.objectContaining({ overrides: { broker: "builtin:postgres" } })));
  });

  it("a non-admin sees the guard and can't apply", () => {
    wrap(<DeploymentStep isAdmin={false} />);
    expect(screen.getByText(/sign in as an admin/i)).toBeInTheDocument();
  });
});
