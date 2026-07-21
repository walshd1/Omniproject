import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Client access to the DEPLOYMENT-TYPE endpoints — the on-ramp archetypes (`/api/deployment-types`) and the
 * org's ONE active deployment type (`/api/deployment-type`). Pick a type, answer a few questions, get a
 * known-good setup; an admin can re-pick the broker/backend and change the active type later.
 */

export interface DeploymentQuestion {
  id: string;
  label: string;
  help?: string;
  options: Array<{ value: string; label: string }>;
  default: string;
}

export interface DeploymentType {
  id: string;
  label: string;
  description: string;
  order: number;
  questions?: DeploymentQuestion[];
  setup: Record<string, string>;
  notes?: string;
}

/** A resolved setting: its descriptor + the value the deployment type tagged it with. */
export interface DeploymentSetting {
  key: string;
  label: string;
  pickable: boolean;
  options: string[];
  value: string;
}

export interface ActiveDeployment {
  deploymentType: string | null;
  answers?: Record<string, string>;
  overrides?: Record<string, string>;
  setup?: Record<string, string>;
  settings?: DeploymentSetting[];
  rejectedOverrides?: string[];
}

export interface SetDeploymentBody {
  deploymentType: string;
  answers?: Record<string, string>;
  overrides?: Record<string, string>;
}

/** The pickable list of deployment archetypes. */
export function useDeploymentTypes() {
  return useQuery({
    queryKey: ["deployment-types"],
    queryFn: () => getJson<{ deploymentTypes: DeploymentType[] }>("/api/deployment-types"),
  });
}

/** The org's currently-active deployment type (deploymentType is null when none is set). */
export function useActiveDeployment() {
  return useQuery({
    queryKey: ["deployment-type"],
    queryFn: () => getJson<ActiveDeployment>("/api/deployment-type"),
  });
}

/** Set / change the org's active deployment type (admin). Invalidates so the whole UI reflects the new posture. */
export function useSetDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetDeploymentBody) => sendJson<ActiveDeployment>("/api/deployment-type", body, "PUT", "Could not set the deployment type"),
    onSuccess: () => { void qc.invalidateQueries(); },
  });
}
