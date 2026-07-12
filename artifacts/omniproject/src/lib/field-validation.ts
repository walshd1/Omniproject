import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/** A per-field data-validation rule (mirrors the server's FieldValidationRule). Numeric fields read
 *  min/max as value bounds; text fields read them as length bounds and honour pattern/options. */
export interface FieldValidationRule {
  field: string;
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  /** Date field: value must be on or after this ISO date. */
  after?: string;
  /** Date field: value must be on or before this ISO date. */
  before?: string;
  options?: string[];
}

export const fieldValidationQueryKey = ["field-validation"] as const;

export function useFieldValidation() {
  return useQuery({
    queryKey: fieldValidationQueryKey,
    queryFn: () => getJson<{ fieldValidation?: FieldValidationRule[] }>("/api/field-validation").then((r) => r.fieldValidation ?? []),
    staleTime: 0,
  });
}

/** Persist the field-validation rules (admin). The server re-validates the definitions (shape +
 *  patterns compile) and 400s a bad rule. */
export function useSaveFieldValidation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rules: FieldValidationRule[]) => sendJson("/api/field-validation", { fieldValidation: rules }, "PUT", "Failed to save validation rules"),
    onSuccess: () => qc.invalidateQueries({ queryKey: fieldValidationQueryKey }),
  });
}
