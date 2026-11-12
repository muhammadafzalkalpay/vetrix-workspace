// Tenant routing: given an organization, return a connection pool for its own
// clinic database. Lookups are cached briefly so each request does not hit the
// registry; pools are cached per database so connections are reused.
import { Pool } from "@neondatabase/serverless";
import { resolveDatabaseRef } from "./database-ref";
import type { TenantDatabase } from "./tenants";

export class TenantNotFoundError extends Error {
  constructor(readonly organization: string) {
    super(`No clinic database is registered for organization "${organization}"`);
    this.name = "TenantNotFoundError";
  }
}

export class TenantUnavailableError extends Error {
  constructor(
    readonly organization: string,
    readonly status: TenantDatabase["status"],
  ) {
    super(`Clinic database for "${organization}" is ${status}`);
    this.name = "TenantUnavailableError";
  }
}

/** The pieces of a pg-style pool the router needs; real Pool or a test fake. */
export interface PoolLike {
  end(): Promise<void>;
}

export interface TenantRouterOptions<P extends PoolLike> {
  /** Finds the tenant row by organization slug or id. */
  lookup: (organization: string) => Promise<TenantDatabase | undefined>;
  createPool: (connectionString: string) => P;
  env?: Record<string, string | undefined>;
  /** How long a registry lookup is reused. Default 60 seconds. */
  ttlMs?: number;
  now?: () => number;
}

export interface TenantRouter<P extends PoolLike> {
  clinicPool(organization: string): Promise<{ tenant: TenantDatabase; pool: P }>;
  /** Forget a cached lookup, e.g. after a tenant is suspended or moved. */
  invalidate(organization: string): void;
  close(): Promise<void>;
}

export function createTenantRouter<P extends PoolLike>(options: TenantRouterOptions<P>): TenantRouter<P> {
  const ttlMs = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  const lookups = new Map<string, { tenant: TenantDatabase; expiresAt: number }>();
  const pools = new Map<string, P>();

  return {
    async clinicPool(organization) {
      let entry = lookups.get(organization);
      if (!entry || entry.expiresAt <= now()) {
        const tenant = await options.lookup(organization);
        if (!tenant) {
          lookups.delete(organization);
          throw new TenantNotFoundError(organization);
        }
        entry = { tenant, expiresAt: now() + ttlMs };
        lookups.set(organization, entry);
      }
      const { tenant } = entry;
      if (tenant.status !== "active") throw new TenantUnavailableError(organization, tenant.status);

      const url = resolveDatabaseRef(tenant.database_ref, options.env);
      let pool = pools.get(url);
      if (!pool) {
        pool = options.createPool(url);
        pools.set(url, pool);
      }
      return { tenant, pool };
    },
    invalidate(organization) {
      lookups.delete(organization);
    },
    async close() {
      const all = [...pools.values()];
      pools.clear();
      lookups.clear();
      await Promise.all(all.map((p) => p.end()));
    },
  };
}

const TENANT_LOOKUP_SQL = `
  SELECT td.id, td.organization_id, o.slug AS organization_slug, td.database_ref,
         td.region, td.schema_version, td.status
  FROM tenant_databases td JOIN organizations o ON o.id = td.organization_id
  WHERE o.status = 'active' AND (o.slug = $1 OR o.id::text = $1)`;

/** Production router: registry over Neon, one small pool per clinic database. */
export function createNeonTenantRouter(registryUrl: string, env: Record<string, string | undefined> = process.env) {
  const registry = new Pool({ connectionString: registryUrl, max: 5 });
  const router = createTenantRouter<Pool>({
    env,
    lookup: async (organization) => {
      const { rows } = await registry.query<TenantDatabase>(TENANT_LOOKUP_SQL, [organization]);
      return rows[0];
    },
    createPool: (connectionString) => new Pool({ connectionString, max: 5 }),
  });
  return {
    registry,
    ...router,
    async close() {
      await router.close();
      await registry.end();
    },
  };
}
