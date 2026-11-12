// Applies the numbered SQL files in db/migrations to one database.
//
// Safety rules:
// - All pending files run in ONE transaction: all succeed or nothing changes.
// - Each database records what ran in vetrix_meta.schema_migrations, inside
//   that same transaction, so the record can never disagree with the schema.
// - A file that changed after it ran is refused (never edit an applied file).
// - Clinic files are refused on a registry database and the other way round.
// - A database with tables but no record (built by hand) is refused, unless
//   adoptExisting is set AND its schema is identical to what the files build.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MigrationTarget = "registry" | "clinic";

export interface Migration {
  version: string; // file name without .sql, e.g. "002_clinic"
  sql: string;
  checksum: string;
}

/** Minimal client shape, satisfied by pg and @neondatabase/serverless clients. */
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export const MIGRATIONS_ROOT = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

/** A table that only exists in one kind of database. */
const MARKER_TABLE: Record<MigrationTarget, string> = {
  registry: "tenant_databases",
  clinic: "patients",
};

export class MigrationError extends Error {
  /** The file that failed, when a specific file failed. */
  readonly version?: string;

  constructor(message: string, version?: string) {
    super(message);
    this.name = "MigrationError";
    this.version = version;
  }
}

export function checksumOf(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export function loadMigrations(target: MigrationTarget, root = MIGRATIONS_ROOT): Migration[] {
  const dir = path.join(root, target);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(file)) {
      throw new MigrationError(`${target}/${file}: name must look like 003_add_thing.sql`);
    }
  }
  return files.map((file) => {
    const sql = readFileSync(path.join(dir, file), "utf8");
    return { version: file.replace(/\.sql$/, ""), sql, checksum: checksumOf(sql) };
  });
}

export async function publicTables(client: SqlClient): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name);
}

export interface AppliedMigration {
  version: string;
  checksum: string;
}

export async function appliedMigrations(client: SqlClient): Promise<AppliedMigration[]> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('vetrix_meta.schema_migrations') IS NOT NULL AS exists`,
  );
  if (!rows[0]?.exists) return [];
  const result = await client.query<AppliedMigration>(
    `SELECT version, checksum FROM vetrix_meta.schema_migrations ORDER BY version`,
  );
  return result.rows;
}

/** Works out what to run, or explains why it is unsafe to run anything. */
export function planMigrations(
  target: MigrationTarget,
  files: Migration[],
  applied: AppliedMigration[],
  tables: string[],
  options: { adoptExisting?: boolean } = {},
): Migration[] {
  const other: MigrationTarget = target === "registry" ? "clinic" : "registry";
  if (tables.includes(MARKER_TABLE[other])) {
    throw new MigrationError(
      `This looks like a ${other} database (it has "${MARKER_TABLE[other]}"). Refusing to apply ${target} migrations.`,
    );
  }
  if (applied.length === 0 && tables.length > 0 && !options.adoptExisting) {
    throw new MigrationError(
      `Database already has ${tables.length} tables but no migration record. ` +
        `Recreate it empty, or rerun with --adopt-existing to verify and adopt the schema.`,
    );
  }
  const byVersion = new Map(files.map((f) => [f.version, f]));
  for (const a of applied) {
    const file = byVersion.get(a.version);
    if (!file) throw new MigrationError(`Database has migration ${a.version}, but that file is missing.`);
    if (file.checksum !== a.checksum) {
      throw new MigrationError(`${target}/${a.version}.sql changed after it was applied. Add a new numbered file instead.`);
    }
  }
  const done = new Set(applied.map((a) => a.version));
  return files.filter((f) => !done.has(f.version));
}

export interface MigrateResult {
  applied: string[];
  /** Files recorded without running, because the schema already matched. */
  adopted: string[];
  tableCount: number;
}

const VERIFY_SCHEMA = "vetrix_verify";

/** Columns, constraints and indexes of one schema, with schema names removed. */
async function schemaSnapshot(client: SqlClient, schema: string): Promise<Set<string>> {
  const strip = (v: string) => v.replace(new RegExp(`\\b(public|${VERIFY_SCHEMA})\\.`, "g"), "");
  const queries = [
    `SELECT format('column %s.%s #%s %s %s null=%s default=%s', table_name, column_name, ordinal_position,
            data_type, udt_name, is_nullable, coalesce(column_default, '')) AS line
     FROM information_schema.columns WHERE table_schema = $1`,
    `SELECT format('constraint %s %s %s', rel.relname, c.conname, pg_get_constraintdef(c.oid)) AS line
     FROM pg_constraint c JOIN pg_class rel ON rel.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = rel.relnamespace WHERE n.nspname = $1`,
    `SELECT format('index %s %s', indexname, indexdef) AS line FROM pg_indexes WHERE schemaname = $1`,
  ];
  const lines = new Set<string>();
  for (const q of queries) {
    for (const row of (await client.query<{ line: string }>(q, [schema])).rows) lines.add(strip(row.line));
  }
  return lines;
}

/**
 * Builds the files into a scratch schema inside the current transaction and
 * compares it with public. Throws with the differences if they do not match.
 */
async function verifySchemaMatches(client: SqlClient, target: MigrationTarget, files: Migration[]): Promise<void> {
  await client.query(`CREATE SCHEMA ${VERIFY_SCHEMA}`);
  await client.query(`SET LOCAL search_path TO ${VERIFY_SCHEMA}, public`);
  for (const m of files) {
    try {
      await client.query(m.sql);
    } catch (error) {
      throw new MigrationError(`${target}/${m.version}.sql failed while verifying: ${(error as Error).message}`, m.version);
    }
  }
  await client.query(`SET LOCAL search_path TO public`);
  const expected = await schemaSnapshot(client, VERIFY_SCHEMA);
  const actual = await schemaSnapshot(client, "public");
  await client.query(`DROP SCHEMA ${VERIFY_SCHEMA} CASCADE`);

  const missing = [...expected].filter((l) => !actual.has(l));
  const extra = [...actual].filter((l) => !expected.has(l));
  if (missing.length || extra.length) {
    const sample = [...missing.map((l) => `  missing: ${l}`), ...extra.map((l) => `  unexpected: ${l}`)].slice(0, 12);
    throw new MigrationError(
      `Existing ${target} schema does not match the migration files ` +
        `(${missing.length} missing, ${extra.length} unexpected). Nothing was adopted.\n${sample.join("\n")}`,
    );
  }
}

/** Runs pending migrations on a dedicated connection (not a shared pool query). */
export async function migrateDatabase(
  client: SqlClient,
  target: MigrationTarget,
  files: Migration[] = loadMigrations(target),
  options: { adoptExisting?: boolean } = {},
): Promise<MigrateResult> {
  await client.query("BEGIN");
  try {
    // Only one runner per database at a time. Released at COMMIT/ROLLBACK,
    // which also works through Neon's pooled (transaction mode) connection.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('vetrix_migrations'))`);
    const applied = await appliedMigrations(client);
    const tables = await publicTables(client);
    const pending = planMigrations(target, files, applied, tables, options);
    const adopt = applied.length === 0 && tables.length > 0;
    if (adopt) await verifySchemaMatches(client, target, pending);

    await client.query(`CREATE SCHEMA IF NOT EXISTS vetrix_meta`);
    await client.query(`CREATE TABLE IF NOT EXISTS vetrix_meta.schema_migrations (
      version text PRIMARY KEY,
      target text NOT NULL CHECK (target IN ('registry', 'clinic')),
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    for (const m of pending) {
      try {
        if (!adopt) await client.query(m.sql);
      } catch (error) {
        throw new MigrationError(`${target}/${m.version}.sql failed: ${(error as Error).message}`, m.version);
      }
      await client.query(
        `INSERT INTO vetrix_meta.schema_migrations (version, target, checksum) VALUES ($1, $2, $3)`,
        [m.version, target, m.checksum],
      );
    }
    const tableCount = (await publicTables(client)).length;
    await client.query("COMMIT");
    const versions = pending.map((m) => m.version);
    return adopt ? { applied: [], adopted: versions, tableCount } : { applied: versions, adopted: [], tableCount };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
