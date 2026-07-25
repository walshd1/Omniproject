import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Client read/write for the AI selection allowlists — the org's governance FLOORS over which providers / models
 * / STT engines may be selected (roadmap Phase C), at `/api/ai/{provider,model,stt-provider}-allowlist`. `null`
 * = unrestricted. A lower scope may only narrow the org ceiling; the value here is already the floor-resolved set.
 * The pickers filter to it, and the server rejects a `PATCH /settings` that selects a forbidden value.
 */
interface AllowlistSpec { path: string; key: string; queryKey: readonly [string]; label: string }
const PROVIDER: AllowlistSpec = { path: "/api/ai/provider-allowlist", key: "aiProviderAllowlist", queryKey: ["ai-provider-allowlist"], label: "AI provider allowlist" };
const MODEL: AllowlistSpec = { path: "/api/ai/model-allowlist", key: "aiModelAllowlist", queryKey: ["ai-model-allowlist"], label: "AI model allowlist" };
const STT: AllowlistSpec = { path: "/api/ai/stt-provider-allowlist", key: "sttProviderAllowlist", queryKey: ["stt-provider-allowlist"], label: "STT provider allowlist" };

function useAllowlist(spec: AllowlistSpec) {
  const { data } = useQuery({
    queryKey: spec.queryKey,
    queryFn: () => getJson<Record<string, string[] | null>>(spec.path),
    staleTime: 15_000,
  });
  return { data: (data?.[spec.key] as string[] | null | undefined) ?? null };
}

function useSaveAllowlist(spec: AllowlistSpec) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: string[] | null) =>
      sendJson<Record<string, string[] | null>>(spec.path, { [spec.key]: value }, "PUT", `Failed to save the ${spec.label}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: spec.queryKey }),
  });
}

export const aiProviderAllowlistKey = PROVIDER.queryKey;
export const aiModelAllowlistKey = MODEL.queryKey;
export const sttProviderAllowlistKey = STT.queryKey;

/** The floor-resolved allowed set (or `null` = unrestricted) for each selection. */
export const useAiProviderAllowlist = () => useAllowlist(PROVIDER);
export const useAiModelAllowlist = () => useAllowlist(MODEL);
export const useSttProviderAllowlist = () => useAllowlist(STT);

/** PUT the ORG ceiling (admin). `null` clears the restriction. */
export const useSaveAiProviderAllowlist = () => useSaveAllowlist(PROVIDER);
export const useSaveAiModelAllowlist = () => useSaveAllowlist(MODEL);
export const useSaveSttProviderAllowlist = () => useSaveAllowlist(STT);

/** Whether `value` may be SELECTED given the resolved allowlist. `alwaysOk` (e.g. "none", or an empty model) is
 *  always allowed; otherwise the value must be within the allowlist (or the allowlist must be unrestricted). */
export function selectable(value: string, allowlist: string[] | null, alwaysOk: (v: string) => boolean = () => false): boolean {
  return alwaysOk(value) || allowlist == null || allowlist.includes(value);
}

/** A provider (or STT engine) is selectable when unrestricted, allowlisted, or `"none"` (off). */
export const providerSelectable = (provider: string, allowlist: string[] | null): boolean =>
  selectable(provider, allowlist, (v) => v === "none");

/** A model is selectable when unrestricted, allowlisted, or empty (= use the provider default). */
export const modelSelectable = (model: string, allowlist: string[] | null): boolean =>
  selectable(model, allowlist, (v) => v.trim() === "");
