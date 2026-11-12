// Database command line. Run from the repository root:
//   pnpm db:migrate                       registry first, then every clinic database
//   pnpm db:migrate --adopt-existing      adopt a hand-built schema after verifying it matches
//   pnpm db:tenant:add --name "Sample Clinic" --slug sample-clinic --ref env:CLINIC_DATABASE_URL_DEV
//   pnpm db:status                        table counts and applied migrations
// Output never includes passwords: only host and database names.
import { parseArgs } from "node:util";
import { Pool } from "@neondatabase/serverless";
import { assertPostgresUrl, describeUrl, neonRegionFromUrl, resolveDatabaseRef } from "./database-ref";
import { appliedMigrations, loadMigrations, migrateDatabase, MigrationError, publicTables, type MigrationTarget } from "./migrations";
import { listTenantDatabases, recordTenantMigrations, registerTenant, setTenantStatus, type TenantDatabase } from "./tenants";

const EXPECTED_TABLES: Record<MigrationTarget, number> = { registry: 8, clinic: 57 };

function registryUrl(): string {
  const url = process.env.REGISTRY_DATABASE_URL;
  if (!url) throw new Error("REGISTRY_DATABASE_URL is not set (apps/web/.env.local or the environment)");
  assertPostgresUrl(url, "REGISTRY_DATABASE_URL");
  return url;
}

/** Runs `fn` with one dedicated connection, then closes everything. */
async function withClient<T>(url: string, fn: (client: import("./migrations").SqlClient) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
    await pool.end();
  }
}

function report(label: string, url: string, target: MigrationTarget, result: import("./migrations").MigrateResult) {
  const { applied, adopted, tableCount } = result;
  const expected = EXPECTED_TABLES[target];
  const ok = tableCount === expected;
  const what = applied.length
    ? `applied ${applied.join(", ")}`
    : adopted.length
      ? `verified and adopted ${adopted.join(", ")}`
      : "already up to date";
  console.log(`${ok ? "✓" : "✗"} ${label} (${describeUrl(url)}): ${what}; ${tableCount}/${expected} tables`);
  if (!ok) throw new Error(`${label} has ${tableCount} tables, expected ${expected}`);
}

async function migrateTenant(
  registry: import("./migrations").SqlClient,
  tenant: TenantDatabase,
  adoptExisting: boolean,
): Promise<void> {
  const url = resolveDatabaseRef(tenant.database_ref);
  const files = loadMigrations("clinic");
  await setTenantStatus(registry, tenant.id, "migrating");
  try {
    const result = await withClient(url, (c) => migrateDatabase(c, "clinic", files, { adoptExisting }));
    await recordTenantMigrations(registry, tenant.id, {
      applied: [...result.adopted, ...result.applied],
      schemaVersion: files.at(-1)?.version ?? null,
    });
    report(`clinic ${tenant.organization_slug}`, url, "clinic", result);
  } catch (error) {
    if (error instanceof MigrationError && error.version) {
      await recordTenantMigrations(registry, tenant.id, { failedVersion: error.version });
    }
    // Nothing changed in the clinic database (single transaction), so the
    // previous status still describes it.
    await setTenantStatus(registry, tenant.id, tenant.status === "migrating" ? "provisioning" : tenant.status);
    throw error;
  }
}

async function migrate(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { "adopt-existing": { type: "boolean", default: false } } });
  const adoptExisting = values["adopt-existing"] ?? false;
  const url = registryUrl();
  const result = await withClient(url, (c) => migrateDatabase(c, "registry", loadMigrations("registry"), { adoptExisting }));
  report("registry", url, "registry", result);

  await withClient(url, async (registry) => {
    const tenants = (await listTenantDatabases(registry)).filter((t) => t.status !== "suspended");
    if (tenants.length === 0) console.log("No clinic databases registered yet. Add one with pnpm db:tenant:add.");
    let failed = 0;
    for (const tenant of tenants) {
      try {
        await migrateTenant(registry, tenant, adoptExisting);
      } catch (error) {
        failed += 1;
        console.error(`✗ clinic ${tenant.organization_slug}: ${(error as Error).message}`);
      }
    }
    if (failed > 0) throw new Error(`${failed} clinic database(s) failed to migrate`);
  });
}

async function addTenant(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      ref: { type: "string" },
      "adopt-existing": { type: "boolean", default: false },
    },
  });
  if (!values.name || !values.slug || !values.ref) {
    throw new Error('Usage: pnpm db:tenant:add --name "Clinic name" --slug clinic-slug --ref env:VARIABLE');
  }
  const clinicUrl = resolveDatabaseRef(values.ref);
  await withClient(registryUrl(), async (registry) => {
    const tenant = await registerTenant(registry, {
      name: values.name!,
      slug: values.slug!,
      databaseRef: values.ref!,
      region: neonRegionFromUrl(clinicUrl),
    });
    console.log(`✓ registered ${tenant.organization_slug} (${describeUrl(clinicUrl)}, ${tenant.region})`);
    await migrateTenant(registry, tenant, values["adopt-existing"] ?? false);
  });
}

async function status(): Promise<void> {
  const url = registryUrl();
  const show = async (label: string, dbUrl: string, target: MigrationTarget) => {
    await withClient(dbUrl, async (c) => {
      const tables = await publicTables(c);
      const applied = (await appliedMigrations(c)).map((a) => a.version);
      const ok = tables.length === EXPECTED_TABLES[target];
      console.log(
        `${ok ? "✓" : "✗"} ${label} (${describeUrl(dbUrl)}): ${tables.length}/${EXPECTED_TABLES[target]} tables; ` +
          `migrations: ${applied.join(", ") || "none"}`,
      );
    });
  };
  await show("registry", url, "registry");
  const tenants = await withClient(url, async (registry) => {
    const tableNames = await publicTables(registry);
    return tableNames.includes("tenant_databases") ? listTenantDatabases(registry) : [];
  });
  if (tenants.length === 0) console.log("No clinic databases registered yet.");
  for (const t of tenants) {
    await show(`clinic ${t.organization_slug} [${t.status}, ${t.region}]`, resolveDatabaseRef(t.database_ref), "clinic");
  }
}

const [command, ...args] = process.argv.slice(2);
// pnpm forwards the "--" separator; drop it so flags parse normally.
const rest = args.filter((arg) => arg !== "--");
const commands: Record<string, () => Promise<void>> = {
  migrate: () => migrate(rest),
  "tenant:add": () => addTenant(rest),
  status,
};

const run = command ? commands[command] : undefined;
if (!run) {
  console.error(`Unknown command "${command ?? ""}". Use: migrate, tenant:add, status`);
  process.exit(1);
}
run().catch((error: unknown) => {
  console.error(`✗ ${(error as Error).message}`);
  process.exit(1);
});
