import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";
import {
  workVocabularyValues,
  localeLabel,
  type WorkVocabularyValues,
  type ResolvedStatus,
  type ResolvedPriority,
} from "@workspace/backend-catalogue";
import { useT } from "./i18n";

/**
 * The org's resolved work-item vocabulary (statuses + priorities) for the SPA. Fetched ONCE at the app
 * root by {@link WorkVocabularyProvider} from the scope-aware `/api/work-vocabulary`, which reflects the
 * full server fold — org/programme/project/user overrides, i18n and accessibility — so the board/pills
 * render the org's own nomenclature, in each user's language, with the org's (or the user's accessible)
 * colours. Consumers read it via {@link useWorkVocabulary}; the compiled shipped default is the context
 * default, so a component rendered WITHOUT the provider (or before the fetch resolves) still works —
 * nothing flashes empty and no per-component network call fires. Colours are hex (inline style); labels
 * are localised by the active UI locale.
 */
const FALLBACK: WorkVocabularyValues = workVocabularyValues();
const NEUTRAL_SWATCH = "#a1a1aa"; // zinc-400 — the backend-agnostic (unknown value) fallback swatch.
const humanize = (v: string): string => v.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export interface WorkVocabulary {
  statuses: ResolvedStatus[];
  priorities: ResolvedPriority[];
  /** Status ids in board order. */
  statusOrder: string[];
  /** Priority ids in ranked order. */
  priorityOrder: string[];
  statusMeta: (id: string) => ResolvedStatus | undefined;
  priorityMeta: (id: string) => ResolvedPriority | undefined;
  /** Localised display label (falls back to a humanised id for an unknown value). */
  statusLabel: (id: string | null | undefined) => string;
  priorityLabel: (id: string | null | undefined) => string;
  /** Swatch colour as a hex string, always defined (neutral swatch for an unknown/uncoloured value). */
  statusColor: (id: string | null | undefined) => string;
  priorityColor: (id: string | null | undefined) => string;
}

/** Build the resolver object from a resolved vocabulary + the active locale. Pure. */
function buildVocabulary(vocab: WorkVocabularyValues, locale: string): WorkVocabulary {
  const statusById = new Map(vocab.statuses.map((s) => [s.id, s]));
  const priorityById = new Map(vocab.priorities.map((p) => [p.id, p]));
  const label = (m: Map<string, { label: string; labels?: Record<string, string> }>) => (id: string | null | undefined) => {
    if (!id) return "";
    const t = m.get(id);
    return t ? localeLabel(t, locale) : humanize(id);
  };
  const colour = (m: Map<string, { color?: string }>) => (id: string | null | undefined) => (id && m.get(id)?.color) || NEUTRAL_SWATCH;
  return {
    statuses: vocab.statuses,
    priorities: vocab.priorities,
    statusOrder: vocab.statuses.map((s) => s.id),
    priorityOrder: vocab.priorities.map((p) => p.id),
    statusMeta: (id) => statusById.get(id),
    priorityMeta: (id) => priorityById.get(id),
    statusLabel: label(statusById),
    priorityLabel: label(priorityById),
    statusColor: colour(statusById),
    priorityColor: colour(priorityById),
  };
}

/** The compiled shipped default (English) — the context default, so consumers work with no provider. */
const FALLBACK_VOCABULARY = buildVocabulary(FALLBACK, "en");

const WorkVocabularyContext = createContext<WorkVocabulary>(FALLBACK_VOCABULARY);

/** Fetches the org-scope resolved vocabulary once and provides it. Mount inside the query + i18n providers. */
export function WorkVocabularyProvider({ children }: { children: ReactNode }) {
  const { locale } = useT();
  const { data } = useQuery({
    queryKey: ["work-vocabulary"],
    queryFn: () => getJson<WorkVocabularyValues>("/api/work-vocabulary"),
    staleTime: 5 * 60_000,
  });
  const value = useMemo(() => buildVocabulary(data ?? FALLBACK, locale), [data, locale]);
  return <WorkVocabularyContext.Provider value={value}>{children}</WorkVocabularyContext.Provider>;
}

/** The resolved work-item vocabulary + label/colour resolvers. Safe without a provider (compiled default). */
export function useWorkVocabulary(): WorkVocabulary {
  return useContext(WorkVocabularyContext);
}
