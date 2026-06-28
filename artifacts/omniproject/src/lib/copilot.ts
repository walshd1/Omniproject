export interface CopilotAnswer { answer: string; projects: number; persona?: { id: string; title: string } }

/** RAG lenses the answer through a methodology persona; freeform answers plainly. */
export type CopilotMode = "rag" | "freeform";

/** Portfolio copilot client. Read-only NL Q&A over the scoped portfolio read model. The
 *  answer carries the methodology persona (lens) the copilot reasoned with, if any. */
export async function askCopilot(question: string, surface?: string, mode: CopilotMode = "rag"): Promise<CopilotAnswer> {
  const res = await fetch("/api/ai/copilot", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, mode, ...(surface ? { surface } : {}) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Copilot failed (${res.status})`);
  }
  return (await res.json()) as CopilotAnswer;
}
