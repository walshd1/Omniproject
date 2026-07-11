/**
 * Zero-at-rest-above-the-seam guard.
 *
 * OmniProject is a stateless overlay: the gateway and the composition tier HOLD NOTHING. All actual
 * persistence lives BELOW the south seam — in a real backend (Jira/OpenProject/…) or, for the
 * optional self-host DB, behind the injected `SelfHostDbPort` whose concrete implementation is the
 * broker's parameterised-SQL workflow (see docs/SELF-HOST-DB.md). The composition tier drives stores
 * only through the abstract `StoreAdapter`; it never imports a database driver.
 *
 * This guard makes that structural, not just conventional: it fails CI if anything above the seam
 * (the gateway `src`, the SPA `src`) imports a persistence layer — a SQL/NoSQL driver, an ORM, a
 * query builder, or an embedded key-value store. A self-host adapter that reached for `pg` directly
 * would put data-at-rest above the seam and silently break the stateless guarantee; here it can't.
 *
 * It catches BOTH static/dynamic imports by literal specifier (`import`/`require`/`import("pg")`) AND
 * the codebase's own variable-specifier indirection `loadOptionalDependency("pg", …)` — otherwise a
 * forbidden package loaded through that wrapper (as `ioredis` is) would sail past a literal-only scan.
 * A short, explicit ALLOWLIST records the deliberate exceptions: an EPHEMERAL coordination cache
 * (Redis for cross-replica pub/sub + soft-TTL registries) is not durable at-rest project data, so it
 * doesn't break the zero-at-rest guarantee — but the exception is named here, not silent.
 *
 * Run: `pnpm --filter @workspace/scripts run guard-zero-at-rest-above-seam`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkFiles } from "./lib/walk-files";
import { importSpecifier } from "./lib/ts-source";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The trees that live ABOVE the south seam — they must never touch a persistence layer. */
const ABOVE_SEAM_DIRS = ["artifacts/api-server/src", "artifacts/omniproject/src"];

/**
 * Persistence-layer module specifiers no above-seam code may import. Covers the common SQL drivers,
 * ORMs / query builders, NoSQL clients, and embedded key-value / on-disk stores. Matched against the
 * import specifier's package root, so `pg`, `pg/lib/x` and `@prisma/client` all trip.
 */
const FORBIDDEN = [
  // SQL drivers
  "pg", "pg-pool", "pg-native", "postgres", "mysql", "mysql2", "sqlite3", "better-sqlite3",
  "node:sqlite", "sqlite", "oracledb", "tedious", "mssql",
  // ORMs / query builders
  "knex", "typeorm", "prisma", "@prisma/client", "sequelize", "drizzle-orm", "kysely", "mikro-orm", "@mikro-orm/core",
  // document / NoSQL
  "mongodb", "mongoose",
  // embedded key-value / on-disk stores
  "redis", "ioredis", "level", "levelup", "leveldown", "lmdb", "node-persist",
  // cloud object stores / NoSQL / warehouses — the retention connectors are pure logic over an
  // injected port; their SDK-backed ports live in the operator's broker/boot layer, never here.
  "@aws-sdk/client-s3", "@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb", "aws-sdk",
  "@google-cloud/storage", "@google-cloud/bigquery", "@google-cloud/firestore",
  "@azure/storage-blob", "@azure/cosmos", "@azure/data-tables",
  "@snowflake/sdk", "snowflake-sdk",
];

/**
 * Deliberate, documented exceptions: a forbidden package that IS allowed at a specific site because
 * its use is EPHEMERAL cross-replica coordination (not durable at-rest project data), keyed by
 * `${relPath}::${packageRoot}`. Keep this list tiny and justified — every entry is a hole in the guard.
 */
const ALLOWLIST = new Set<string>([
  // Redis as an OPTIONAL, runtime-loaded pub/sub + soft-TTL cache for multi-replica coordination
  // (broker-log fan-out, shared registries, rate-limit). It holds no system-of-record data; without
  // it the gateway simply degrades to per-replica. This is coordination state, not persistence.
  "artifacts/api-server/src/lib/shared-state.ts::ioredis",
]);

/** Every package pulled in via the `loadOptionalDependency("pkg", …)` variable-specifier wrapper in a
 *  file (the pkg name is the first string-literal arg; the call often spans lines, so scan whole text). */
function optionalDependencySpecifiers(text: string): string[] {
  const out: string[] = [];
  const re = /\bloadOptionalDependency\s*(?:<[^>]*>)?\s*\(\s*["']([^"']+)["']/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1]!);
  return out;
}

/** The package root of a specifier: `pg/lib/x` → `pg`, `@prisma/client/edge` → `@prisma/client`. */
function packageRoot(spec: string): string {
  if (spec.startsWith("@")) return spec.split("/").slice(0, 2).join("/");
  return spec.split("/")[0]!;
}

const FORBIDDEN_SET = new Set(FORBIDDEN);

function listSourceFiles(relDir: string): string[] {
  return walkFiles(path.join(ROOT, relDir), {
    extensions: [".ts", ".tsx"],
    // Test files may legitimately stub a store; the guard governs shipped code paths only.
    excludeSuffixes: [".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx"],
  }).map((abs) => path.relative(ROOT, abs));
}

const violations: string[] = [];

for (const dir of ABOVE_SEAM_DIRS) {
  for (const rel of listSourceFiles(dir)) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    src.split("\n").forEach((line, i) => {
      const spec = importSpecifier(line);
      if (!spec) return;
      if (FORBIDDEN_SET.has(packageRoot(spec))) {
        violations.push(`${rel}:${i + 1}  [persistence] imports '${spec}' — ${line.trim().slice(0, 80)}`);
      }
    });
    // Also catch the variable-specifier indirection: loadOptionalDependency("<forbidden>", …).
    for (const spec of optionalDependencySpecifiers(src)) {
      const root = packageRoot(spec);
      if (FORBIDDEN_SET.has(root) && !ALLOWLIST.has(`${rel}::${root}`)) {
        violations.push(`${rel}  [persistence] loadOptionalDependency('${spec}') — forbidden package via dynamic import (add to the ALLOWLIST only if it's ephemeral coordination, not at-rest data)`);
      }
    }
  }
}

if (violations.length) {
  console.error("::error::Zero-at-rest guard failed — persistence leaked above the south seam:");
  for (const v of violations) console.error("  " + v);
  console.error(
    "\nThe gateway and the composition tier hold nothing: all data-at-rest lives BELOW the seam, in a " +
      "backend or behind the injected SelfHostDbPort (the broker's parameterised-SQL workflow). Above the " +
      "seam, drive stores only through the abstract StoreAdapter — never import a database driver/ORM/KV store.",
  );
  process.exit(1);
}

console.log(
  `zero-at-rest guard: OK — no persistence-layer import above the seam (scanned ${ABOVE_SEAM_DIRS.join(", ")}).`,
);
