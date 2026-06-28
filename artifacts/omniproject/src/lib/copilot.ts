/** Portfolio copilot client. Read-only NL Q&A over the scoped portfolio read model. */
export async function askCopilot(question: string, surface?: string): Promise<{ answer: string; projects: number }> {
  const res = await fetch("/api/ai/copilot", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, ...(surface ? { surface } : {}) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Copilot failed (${res.status})`);
  }
  return (await res.json()) as { answer: string; projects: number };
}
