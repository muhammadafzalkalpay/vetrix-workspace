// One tenant router per server process: the registry pool plus one pool per
// clinic database. Kept on globalThis so dev reloads do not open new pools.
import "server-only";
import { createNeonTenantRouter } from "@vetrix/db/runtime";
import { getEnv } from "./env";

type NeonTenantRouter = ReturnType<typeof createNeonTenantRouter>;
const globalForTenancy = globalThis as unknown as { vetrixTenancy?: NeonTenantRouter };

export function tenancy(): NeonTenantRouter {
  globalForTenancy.vetrixTenancy ??= createNeonTenantRouter(getEnv().REGISTRY_DATABASE_URL);
  return globalForTenancy.vetrixTenancy;
}
