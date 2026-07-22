import { configResource } from "./config-resource";

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

const resource = configResource<FieldValidationRule[]>({
  queryKey: fieldValidationQueryKey,
  path: "/api/field-validation",
  envelopeKey: "fieldValidation",
  empty: [],
  staleTime: 0,
  // The server re-validates the definitions (shape + patterns compile) and 400s a bad rule.
  saveErrorMessage: "Failed to save validation rules",
});
export const useFieldValidation = resource.useResource;
/** Persist the field-validation rules (admin). */
export const useSaveFieldValidation = resource.useSaveResource;
