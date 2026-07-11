/**
 * Shared ANSI colour helpers for the script-level CLIs (verifiers, wizard, load/stress harnesses).
 * One palette so each script stops re-declaring its own `\x1b[..m` wrappers. `amber` and `yellow`
 * are both SGR 33 — two names are kept because different call sites read one or the other.
 */
const wrap = (code: number) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;

export const bold = wrap(1);
export const dim = wrap(2);
export const red = wrap(31);
export const green = wrap(32);
export const yellow = wrap(33);
export const amber = wrap(33);
