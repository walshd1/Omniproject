import type { Request, Response } from "express";

/**
 * Zero-trust request validation — a tiny, dependency-free schema validator for the gateway's
 * UNTRUSTED boundary inputs (req.body / query / params). The principle: never `as`-cast an
 * external value into a typed shape; PARSE it against an explicit schema, and reject anything
 * that doesn't conform with a 400. Each validator both narrows the TYPE and enforces a RULE
 * (presence, type, length, range, pattern, allowed set), so "typed + validated" is one step.
 *
 * Kept deliberately small (no zod dependency) and synchronous; for the generated OpenAPI
 * request bodies the api-zod schemas remain the source of truth — this covers the many
 * hand-rolled admin/AI endpoints that previously cast `req.body as {...}` unchecked.
 */

/** Raised when a value fails its schema; carries human-readable, path-qualified issues. */
export class ValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "ValidationError";
  }
}

/** A validator narrows `unknown` to `T` or throws {@link ValidationError}. */
export type Validator<T> = (value: unknown, path?: string) => T;

/** Infer the parsed type of a validator. */
export type Infer<V> = V extends Validator<infer T> ? T : never;

const fail = (path: string, msg: string): never => {
  throw new ValidationError([`${path} ${msg}`]);
};

export const v = {
  /** A string, optionally trimmed, length-bounded, or pattern-matched. */
  string(opts: { min?: number; max?: number; pattern?: RegExp; trim?: boolean } = {}): Validator<string> {
    return (value, path = "value") => {
      if (typeof value !== "string") return fail(path, "must be a string");
      const s = opts.trim ? value.trim() : value;
      if (opts.min !== undefined && s.length < opts.min) return fail(path, `must be at least ${opts.min} chars`);
      if (opts.max !== undefined && s.length > opts.max) return fail(path, `must be at most ${opts.max} chars`);
      if (opts.pattern && !opts.pattern.test(s)) return fail(path, "has an invalid format");
      return s;
    };
  },
  /** A finite number; `int` forces an integer. Accepts a numeric string (query params). */
  number(opts: { min?: number; max?: number; int?: boolean } = {}): Validator<number> {
    return (value, path = "value") => {
      const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n)) return fail(path, "must be a number");
      if (opts.int && !Number.isInteger(n)) return fail(path, "must be an integer");
      if (opts.min !== undefined && n < opts.min) return fail(path, `must be >= ${opts.min}`);
      if (opts.max !== undefined && n > opts.max) return fail(path, `must be <= ${opts.max}`);
      return n;
    };
  },
  /** A boolean. Accepts the strings "true"/"false" (query/form params). */
  boolean(): Validator<boolean> {
    return (value, path = "value") => {
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return fail(path, "must be a boolean");
    };
  },
  /** One of a fixed set of string literals. */
  enum<T extends string>(values: readonly T[]): Validator<T> {
    return (value, path = "value") => {
      if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as T;
      return fail(path, `must be one of: ${values.join(", ")}`);
    };
  },
  /** A homogeneous array, optionally length-capped. */
  array<T>(item: Validator<T>, opts: { min?: number; max?: number } = {}): Validator<T[]> {
    return (value, path = "value") => {
      if (!Array.isArray(value)) return fail(path, "must be an array");
      if (opts.min !== undefined && value.length < opts.min) return fail(path, `must have at least ${opts.min} items`);
      if (opts.max !== undefined && value.length > opts.max) return fail(path, `must have at most ${opts.max} items`);
      return value.map((el, i) => item(el, `${path}[${i}]`));
    };
  },
  /** An object with a fixed shape; unknown keys are dropped (not an error). Missing required
   *  keys fail; use {@link v.optional} for optional ones. */
  object<S extends Record<string, Validator<unknown>>>(shape: S): Validator<{ [K in keyof S]: Infer<S[K]> }> {
    return (value, path = "body") => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return fail(path, "must be an object");
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const issues: string[] = [];
      for (const key of Object.keys(shape)) {
        try { out[key] = shape[key]!(obj[key], `${path}.${key}`); }
        catch (e) { if (e instanceof ValidationError) issues.push(...e.issues); else throw e; }
      }
      if (issues.length) throw new ValidationError(issues);
      return out as { [K in keyof S]: Infer<S[K]> };
    };
  },
  /** Makes a field optional: `undefined`/missing passes through; otherwise validates. */
  optional<T>(inner: Validator<T>): Validator<T | undefined> {
    return (value, path) => (value === undefined ? undefined : inner(value, path));
  },
};

/** Parse an untrusted request part against a schema. On failure, send a 400 with the issues
 *  and return null (the caller returns); on success, return the typed, validated value. */
export function parseOr400<T>(req: Request, res: Response, schema: Validator<T>, source: "body" | "query" | "params" = "body"): T | null {
  try {
    return schema(req[source], source);
  } catch (e) {
    if (e instanceof ValidationError) {
      res.status(400).json({ error: "invalid request", issues: e.issues });
      return null;
    }
    throw e;
  }
}
