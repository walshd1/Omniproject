import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

export const CUSTOM_FIELD_TYPES = ["string", "number", "boolean", "date"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** An admin-defined field extending the reference superset. */
export interface CustomField {
  key: string;
  label: string;
  type: CustomFieldType;
}

export const customFieldsQueryKey = ["custom-fields"] as const;

export function useCustomFields() {
  return useQuery({
    queryKey: customFieldsQueryKey,
    queryFn: () => getJson<{ customFields?: CustomField[] }>("/api/custom-fields").then((r) => r.customFields ?? []),
    staleTime: 0,
  });
}

/** Persist the custom fields (admin). The server re-checks the source rule (mapped or built-in) and
 *  400s a field with no data source. */
export function useSaveCustomFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: CustomField[]) => sendJson("/api/custom-fields", { customFields: fields }, "PUT", "Failed to save custom fields"),
    onSuccess: () => qc.invalidateQueries({ queryKey: customFieldsQueryKey }),
  });
}
