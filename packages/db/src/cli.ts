// Database command line. Run from the repository root:
//   pnpm db:migrate                       registry first, then every clinic database
//   pnpm db:migrate --adopt-existing      adopt a hand-built schema after verifying it matches
//   pnpm db:tenant:add --name "Sample Clinic" --slug sample-clinic --ref env:CLINIC_DATABASE_URL_DEV
//   pnpm db:status                        table counts and applied migrations
//   pnpm db:packs:publish                 publish the bundled veterinary pack to the registry
//   pnpm db:seed:sample --org <slug> [--replace]   sample clinic data (non-production only)
//   pnpm db:staff:add --org <slug> --email a@b.com --name "Jo Smith" --role owner [--location <id>]
//   pnpm db:phone:add --org <slug> --number +15555550100 [--location <id>]   route a Twilio number to a location
// Output never includes passwords: only host and database names.
import { parseArgs } from "node:util";
import { Pool } from "@neondatabase/serverless";
import { assertPostgresUrl, describeUrl, neonRegionFromUrl, resolveDatabaseRef } from "./database-ref";
import { appliedMigrations, loadMigrations, migrateDatabase, MigrationError, publicTables, type MigrationTarget } from "./migrations";
import { getVeterinaryPack, veterinaryRawPack } from "@vetrix/pack";
import { publishPack } from "./packs";
import { seedSampleClinic } from "./seed/sample-clinic";
import { syncRoleCatalogue, upsertStaffMember } from "./access";
import { addOrganizationMember, ensurePlatformUser } from "./members";
import { isRoleKey, ROLE_KEYS } from "@vetrix/domain";
import { assignPhoneNumber } from "./phone-numbers";
import { listTenantDatabases, recordTenantMigrations, registerTenant, setTenantStatus, type TenantDatabase } from "./tenants";

const EXPECTED_TABLES: Record<MigrationTarget, number> = { registry: 13, clinic: 59 };

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
    const result = await withClient(url, async (c) => {
      const migrated = await migrateDatabase(c, "clinic", files, { adoptExisting });
      // Keep the default roles in step with the code on every migrate.
      await c.query("BEGIN");
      try {
        await syncRoleCatalogue(c);
        await c.query("COMMIT");
      } catch (error) {
        await c.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      return migrated;
    });
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

async function packsPublish(): Promise<void> {
  await withClient(registryUrl(), async (registry) => {
    const result = await publishPack(registry, veterinaryRawPack);
    console.log(
      `✓ veterinary pack ${result.version} ${result.created ? "published" : "already published, content unchanged"}`,
    );
  });
}

async function seedSample(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { org: { type: "string" }, replace: { type: "boolean", default: false } },
  });
  if (!values.org) throw new Error("Usage: pnpm db:seed:sample --org <organization-slug> [--replace]");
  await withClient(registryUrl(), async (registry) => {
    const tenant = (await listTenantDatabases(registry)).find((t) => t.organization_slug === values.org);
    if (!tenant) throw new Error(`Organization "${values.org}" is not registered`);
    // Production clinic databases use secret refs, never env: refs.
    if (!tenant.database_ref.startsWith("env:")) {
      throw new Error(`Refusing to load sample data into ${values.org}: it is not a development database`);
    }
    const published = await publishPack(registry, veterinaryRawPack);
    const pack = getVeterinaryPack();
    const url = resolveDatabaseRef(tenant.database_ref);

    const summary = await withClient(url, async (clinic) => {
      await clinic.query("BEGIN");
      try {
        const { rows } = await clinic.query<{ n: number }>(`SELECT count(*)::int AS n FROM locations`);
        if ((rows[0]?.n ?? 0) > 0) {
          if (!values.replace) {
            throw new Error(`${values.org} already has data. Use --replace to delete it and load the sample clinic again.`);
          }
          const tables = await publicTables(clinic);
          await clinic.query(`TRUNCATE ${tables.map((t) => `public."${t}"`).join(", ")} CASCADE`);
        }
        const result = await seedSampleClinic(clinic, pack, { configPackId: published.configPackId });
        await syncRoleCatalogue(clinic);
        await clinic.query("COMMIT");
        return result;
      } catch (error) {
        await clinic.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });
    console.log(
      `✓ sample clinic loaded into ${values.org} (${describeUrl(url)}): ${summary.clients} clients, ` +
        `${summary.patients} patients, ${summary.appointments} past visits, ${summary.vaccineRecords} vaccine records`,
    );
    for (const w of summary.warnings) console.log(`  ! ${w}`);
  });
}

async function staffAdd(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      org: { type: "string" },
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
      location: { type: "string", multiple: true },
    },
  });
  const { org, email, name, role } = values;
  if (!org || !email || !name || !role) {
    throw new Error('Usage: pnpm db:staff:add --org <slug> --email a@b.com --name "Jo Smith" --role owner [--location <id>]');
  }
  if (!isRoleKey(role)) throw new Error(`role must be one of: ${ROLE_KEYS.join(", ")}`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("email does not look valid");

  await withClient(registryUrl(), async (registry) => {
    const tenant = (await listTenantDatabases(registry)).find((t) => t.organization_slug === org);
    if (!tenant) throw new Error(`Organization "${org}" is not registered`);
    const user = await ensurePlatformUser(registry, email, name);
    await withClient(resolveDatabaseRef(tenant.database_ref), async (clinic) => {
      await clinic.query("BEGIN");
      try {
        await syncRoleCatalogue(clinic);
        await upsertStaffMember(clinic, {
          platformUserId: user.id,
          displayName: name,
          role,
          locationIds: values.location,
        });
        await clinic.query("COMMIT");
      } catch (error) {
        await clinic.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });
    // Membership last: the person can only open the organization once their
    // staff record exists.
    await addOrganizationMember(registry, tenant.organization_id, user.id);
    console.log(`✓ ${email} is ${role} at ${org}${values.location ? ` (${values.location.length} location(s))` : " (all locations)"}`);
    console.log("  They set their password with \"Forgot password\" on the sign-in page.");
  });
}

async function phoneAdd(args: string[]) {
  const { values } = parseArgs({ args, options: { org: { type: "string" }, number: { type: "string" }, location: { type: "string" } } });
  const { org, number } = values;
  if (!org || !number) throw new Error("Usage: pnpm db:phone:add --org <slug> --number +15555550100 [--location <id>]");
  await withClient(registryUrl(), async (registry) => {
    const tenant = (await listTenantDatabases(registry)).find((t) => t.organization_slug === org);
    if (!tenant) throw new Error(`Organization "${org}" is not registered`);
    const locationId = await withClient(resolveDatabaseRef(tenant.database_ref), async (clinic) => {
      const { rows } = await clinic.query<{ id: string; name: string }>(
        values.location ? `SELECT id, name FROM locations WHERE id = $1` : `SELECT id, name FROM locations ORDER BY name`,
        values.location ? [values.location] : [],
      );
      if (rows.length === 0) throw new Error("Location not found");
      if (rows.length > 1) throw new Error(`This organization has ${rows.length} locations; pass --location <id>`);
      return rows[0]!.id;
    });
    const route = await assignPhoneNumber(registry, { number, organizationId: tenant.organization_id, locationId });
    console.log(`✓ ${route.e164} now answers for ${org} (location ${route.locationId})`);
  });
}

const [command, ...args] = process.argv.slice(2);
// pnpm forwards the "--" separator; drop it so flags parse normally.
const rest = args.filter((arg) => arg !== "--");
const commands: Record<string, () => Promise<void>> = {
  migrate: () => migrate(rest),
  "tenant:add": () => addTenant(rest),
  status,
  "packs:publish": packsPublish,
  "seed:sample": () => seedSample(rest),
  "staff:add": () => staffAdd(rest),
  "phone:add": () => phoneAdd(rest),
};

const run = command ? commands[command] : undefined;
if (!run) {
  console.error(`Unknown command "${command ?? ""}". Use: migrate, tenant:add, status, packs:publish, seed:sample, staff:add, phone:add`);
  process.exit(1);
}
run().catch((error: unknown) => {
  console.error(`✗ ${(error as Error).message}`);
  process.exit(1);
});
