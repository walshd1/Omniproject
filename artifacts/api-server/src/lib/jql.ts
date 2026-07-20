/**
 * JQL — a rich, Jira-style query language for the read model, evaluated ABOVE the broker seam over rows
 * a backend already returned (never pushed into a datastore). It is a PURE, deterministic filter+sort:
 * no SQL, no `eval`, no regex built from input (so no injection and no ReDoS), and it only READS row
 * fields — it can neither mutate nor reach a backend. The search TOOL that uses it is gated + scoped
 * elsewhere; this file is just the language.
 *
 * Grammar (precedence OR < AND < NOT):
 *   query    := expr? ("ORDER BY" orderKey ("," orderKey)*)?
 *   expr     := orExpr
 *   orExpr   := andExpr ("OR" andExpr)*
 *   andExpr  := notExpr ("AND" notExpr)*
 *   notExpr  := "NOT" notExpr | primary
 *   primary  := "(" expr ")" | predicate
 *   predicate:= field ("IS" "NOT"? "EMPTY" | op value)
 *   op       := "=" | "!=" | ">" | ">=" | "<" | "<=" | "~" | "!~" | "IN" | "NOT" "IN"
 *   value    := STRING | NUMBER | BOOL | "(" scalar ("," scalar)* ")"     // list only for IN / NOT IN
 *   orderKey := field ("ASC" | "DESC")?
 *
 * Field names are `[A-Za-z][A-Za-z0-9_.]*` — the leading-letter rule excludes `__proto__`/`constructor`
 * as query fields, so a lookup can't reach a prototype key.
 */

type Row = Record<string, unknown>;
type Scalar = string | number | boolean;

export class JqlError extends Error {
  constructor(message: string) { super(message); this.name = "JqlError"; }
}

// Bounds — an adversarial query must not exhaust CPU/stack.
const MAX_INPUT = 4000;
const MAX_DEPTH = 64;
const MAX_ORDER_KEYS = 8;
const MAX_IN_LIST = 200;

export type CmpOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "~" | "!~" | "in" | "notin";
export type Node =
  | { kind: "and"; left: Node; right: Node }
  | { kind: "or"; left: Node; right: Node }
  | { kind: "not"; node: Node }
  | { kind: "cmp"; field: string; op: CmpOp; value: Scalar | Scalar[] }
  | { kind: "empty"; field: string; negated: boolean };

export interface OrderKey { field: string; dir: "asc" | "desc"; }
export interface JqlQuery { where: Node | null; orderBy: OrderKey[]; }

// ── Tokenizer ────────────────────────────────────────────────────────────────
type Tok =
  | { t: "field"; v: string }
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "op"; v: CmpOp }
  | { t: "kw"; v: "AND" | "OR" | "NOT" | "IN" | "IS" | "EMPTY" | "ORDER" | "BY" | "ASC" | "DESC" }
  | { t: "("; }
  | { t: ")"; }
  | { t: ","; };

const KEYWORDS = new Set(["AND", "OR", "NOT", "IN", "IS", "EMPTY", "ORDER", "BY", "ASC", "DESC"]);

function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "(") { toks.push({ t: "(" }); i++; continue; }
    if (c === ")") { toks.push({ t: ")" }); i++; continue; }
    if (c === ",") { toks.push({ t: "," }); i++; continue; }
    // Multi/single-char operators.
    if (c === "!" && input[i + 1] === "=") { toks.push({ t: "op", v: "!=" }); i += 2; continue; }
    if (c === "!" && input[i + 1] === "~") { toks.push({ t: "op", v: "!~" }); i += 2; continue; }
    if (c === ">") { if (input[i + 1] === "=") { toks.push({ t: "op", v: ">=" }); i += 2; } else { toks.push({ t: "op", v: ">" }); i++; } continue; }
    if (c === "<") { if (input[i + 1] === "=") { toks.push({ t: "op", v: "<=" }); i += 2; } else { toks.push({ t: "op", v: "<" }); i++; } continue; }
    if (c === "=") { toks.push({ t: "op", v: "=" }); i++; continue; }
    if (c === "~") { toks.push({ t: "op", v: "~" }); i++; continue; }
    // Quoted string ('…' or "…"), doubled quote = literal quote.
    if (c === "'" || c === '"') {
      const quote = c; i++; let s = "";
      while (i < n) {
        if (input[i] === quote) {
          if (input[i + 1] === quote) { s += quote; i += 2; continue; } // escaped
          i++; break;
        }
        s += input[i]; i++;
        if (i >= n) throw new JqlError("unterminated string literal");
      }
      toks.push({ t: "str", v: s });
      continue;
    }
    // Number.
    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < n && /[0-9.]/.test(input[j]!)) j++;
      const raw = input.slice(i, j);
      const num = Number(raw);
      if (!Number.isFinite(num)) throw new JqlError(`invalid number: ${raw}`);
      toks.push({ t: "num", v: num }); i = j; continue;
    }
    // Identifier / keyword / bool.
    if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_.]/.test(input[j]!)) j++;
      const word = input.slice(i, j);
      const upper = word.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") toks.push({ t: "bool", v: upper === "TRUE" });
      else if (KEYWORDS.has(upper)) toks.push({ t: "kw", v: upper as Extract<Tok, { t: "kw" }>["v"] });
      else toks.push({ t: "field", v: word });
      i = j; continue;
    }
    throw new JqlError(`unexpected character '${c}' at ${i}`);
  }
  return toks;
}

// ── Parser (recursive descent) ───────────────────────────────────────────────
class Parser {
  private pos = 0;
  private depth = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private next(): Tok | undefined { return this.toks[this.pos++]; }
  private isKw(v: string): boolean { const t = this.peek(); return !!t && t.t === "kw" && t.v === v; }

  parse(): JqlQuery {
    let where: Node | null = null;
    // An empty query (or one that starts with ORDER BY) has no WHERE.
    if (this.peek() && !this.isKw("ORDER")) where = this.parseOr();
    const orderBy = this.isKw("ORDER") ? this.parseOrder() : [];
    if (this.pos !== this.toks.length) throw new JqlError("unexpected trailing input in query");
    return { where, orderBy };
  }

  private enter(): void { if (++this.depth > MAX_DEPTH) throw new JqlError("query nested too deeply"); }
  private leave(): void { this.depth--; }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.isKw("OR")) { this.next(); left = { kind: "or", left, right: this.parseAnd() }; }
    return left;
  }
  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.isKw("AND")) { this.next(); left = { kind: "and", left, right: this.parseNot() }; }
    return left;
  }
  private parseNot(): Node {
    if (this.isKw("NOT")) { this.next(); this.enter(); const node = this.parseNot(); this.leave(); return { kind: "not", node }; }
    return this.parsePrimary();
  }
  private parsePrimary(): Node {
    const t = this.peek();
    if (t && t.t === "(") {
      this.next(); this.enter();
      const inner = this.parseOr();
      this.leave();
      const close = this.next();
      if (!close || close.t !== ")") throw new JqlError("missing closing ')'");
      return inner;
    }
    return this.parsePredicate();
  }

  private parsePredicate(): Node {
    const f = this.next();
    if (!f || f.t !== "field") throw new JqlError("expected a field name");
    const field = f.v;
    // IS [NOT] EMPTY
    if (this.isKw("IS")) {
      this.next();
      let negated = false;
      if (this.isKw("NOT")) { this.next(); negated = true; }
      if (!this.isKw("EMPTY")) throw new JqlError(`expected EMPTY after ${field} IS`);
      this.next();
      return { kind: "empty", field, negated };
    }
    // NOT IN
    if (this.isKw("NOT")) {
      this.next();
      if (!this.isKw("IN")) throw new JqlError(`expected IN after ${field} NOT`);
      this.next();
      return { kind: "cmp", field, op: "notin", value: this.parseList() };
    }
    // IN
    if (this.isKw("IN")) { this.next(); return { kind: "cmp", field, op: "in", value: this.parseList() }; }
    // Binary operator.
    const opTok = this.next();
    if (!opTok || opTok.t !== "op") throw new JqlError(`expected an operator after field '${field}'`);
    return { kind: "cmp", field, op: opTok.v, value: this.parseScalar() };
  }

  private parseScalar(): Scalar {
    const t = this.next();
    if (!t) throw new JqlError("expected a value");
    if (t.t === "str") return t.v;
    if (t.t === "num") return t.v;
    if (t.t === "bool") return t.v;
    if (t.t === "field") return t.v; // a bareword value (unquoted) is treated as a string
    throw new JqlError("expected a string, number or boolean value");
  }

  private parseList(): Scalar[] {
    const open = this.next();
    if (!open || open.t !== "(") throw new JqlError("expected '(' to start an IN list");
    const out: Scalar[] = [];
    if (this.peek()?.t === ")") { this.next(); return out; }
    for (;;) {
      out.push(this.parseScalar());
      if (out.length > MAX_IN_LIST) throw new JqlError("IN list too long");
      const sep = this.next();
      if (sep && sep.t === ")") break;
      if (!sep || sep.t !== ",") throw new JqlError("expected ',' or ')' in IN list");
    }
    return out;
  }

  private parseOrder(): OrderKey[] {
    this.next(); // ORDER
    if (!this.isKw("BY")) throw new JqlError("expected BY after ORDER");
    this.next();
    const keys: OrderKey[] = [];
    for (;;) {
      const f = this.next();
      if (!f || f.t !== "field") throw new JqlError("expected a field name in ORDER BY");
      let dir: "asc" | "desc" = "asc";
      if (this.isKw("ASC")) this.next();
      else if (this.isKw("DESC")) { this.next(); dir = "desc"; }
      keys.push({ field: f.v, dir });
      if (keys.length > MAX_ORDER_KEYS) throw new JqlError("too many ORDER BY keys");
      if (this.peek()?.t === ",") { this.next(); continue; }
      break;
    }
    return keys;
  }
}

/** Parse a JQL string into a validated query AST. Throws {@link JqlError} on any syntax error. */
export function parseJql(input: string): JqlQuery {
  if (typeof input !== "string") throw new JqlError("query must be a string");
  if (input.length > MAX_INPUT) throw new JqlError(`query too long (max ${MAX_INPUT} chars)`);
  return new Parser(tokenize(input)).parse();
}

// ── Evaluator ────────────────────────────────────────────────────────────────
function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Loose scalar equality: case-insensitive for strings, numeric/boolean coercion otherwise. */
function looseEq(rowVal: unknown, qVal: Scalar): boolean {
  if (typeof qVal === "number") return typeof rowVal === "number" ? rowVal === qVal : Number(rowVal) === qVal;
  if (typeof qVal === "boolean") return typeof rowVal === "boolean" ? rowVal === qVal : String(rowVal).toLowerCase() === String(qVal);
  return String(rowVal ?? "").toLowerCase() === qVal.toLowerCase();
}

/** Ordered comparison: numeric when both are numbers, else locale string compare (ISO dates sort right). */
function cmpOrder(a: unknown, b: Scalar): number {
  if (typeof b === "number" && typeof a === "number") return a - b;
  if (typeof b === "number") { const na = Number(a); return Number.isNaN(na) ? NaN : na - b; }
  return String(a ?? "").localeCompare(String(b));
}

function evalNode(node: Node, row: Row): boolean {
  switch (node.kind) {
    case "and": return evalNode(node.left, row) && evalNode(node.right, row);
    case "or": return evalNode(node.left, row) || evalNode(node.right, row);
    case "not": return !evalNode(node.node, row);
    case "empty": { const e = isEmpty(row[node.field]); return node.negated ? !e : e; }
    case "cmp": {
      const v = row[node.field];
      switch (node.op) {
        case "=": return !isEmpty(v) && looseEq(v, node.value as Scalar);
        case "!=": return !looseEq(v, node.value as Scalar);
        case "~": return !isEmpty(v) && String(v).toLowerCase().includes(String(node.value).toLowerCase());
        case "!~": return isEmpty(v) || !String(v).toLowerCase().includes(String(node.value).toLowerCase());
        case "in": return !isEmpty(v) && (node.value as Scalar[]).some((x) => looseEq(v, x));
        case "notin": return !(node.value as Scalar[]).some((x) => looseEq(v, x));
        // An empty/missing value never satisfies an ordered comparison (null must not coerce to 0).
        case ">": { if (isEmpty(v)) return false; const c = cmpOrder(v, node.value as Scalar); return !Number.isNaN(c) && c > 0; }
        case ">=": { if (isEmpty(v)) return false; const c = cmpOrder(v, node.value as Scalar); return !Number.isNaN(c) && c >= 0; }
        case "<": { if (isEmpty(v)) return false; const c = cmpOrder(v, node.value as Scalar); return !Number.isNaN(c) && c < 0; }
        case "<=": { if (isEmpty(v)) return false; const c = cmpOrder(v, node.value as Scalar); return !Number.isNaN(c) && c <= 0; }
      }
    }
  }
}

function sortRows(rows: Row[], keys: OrderKey[]): Row[] {
  if (keys.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const av = a[k.field]; const bv = b[k.field];
      // Missing values always sort to the END regardless of direction.
      const ae = isEmpty(av); const be = isEmpty(bv);
      if (ae && be) continue;
      if (ae) return 1;
      if (be) return -1;
      let c: number;
      if (typeof av === "number" && typeof bv === "number") c = av - bv;
      else c = String(av).localeCompare(String(bv));
      if (c !== 0) return k.dir === "desc" ? -c : c;
    }
    return 0;
  });
}

/** Filter + sort `rows` by a JQL query (string or pre-parsed), optionally capping the result count.
 *  Pure — reads only the given rows, reaches nothing. Throws {@link JqlError} on a bad query string. */
export function runJql(rows: Row[], query: JqlQuery | string, opts: { limit?: number } = {}): Row[] {
  const q = typeof query === "string" ? parseJql(query) : query;
  const filtered = q.where ? rows.filter((r) => evalNode(q.where!, r)) : rows.slice();
  const sorted = sortRows(filtered, q.orderBy);
  return typeof opts.limit === "number" && opts.limit >= 0 ? sorted.slice(0, opts.limit) : sorted;
}
