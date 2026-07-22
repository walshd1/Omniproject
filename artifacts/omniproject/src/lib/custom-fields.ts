import { configResource } from "./config-resource";

export const CUSTOM_FIELD_TYPES = ["string", "number", "boolean", "date"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** An admin-defined field extending the reference superset. */
export interface CustomField {
  key: string;
  label: string;
  type: CustomFieldType;
}

export const customFieldsQueryKey = ["custom-fields"] as const;

const resource = configResource<CustomField[]>({
  queryKey: customFieldsQueryKey,
  path: "/api/custom-fields",
  envelopeKey: "customFields",
  empty: [],
  staleTime: 0,
  // The server re-checks the source rule (mapped or built-in) and 400s a field with no data source.
  saveErrorMessage: "Failed to save custom fields",
});
export const useCustomFields = resource.useResource;
/** Persist the custom fields (admin). */
export const useSaveCustomFields = resource.useSaveResource;
