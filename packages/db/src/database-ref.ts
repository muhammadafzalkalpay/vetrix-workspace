// tenant_databases.database_ref says where a clinic database's connection
// string lives. The registry never stores the secret itself.
//   env:NAME          read from an environment variable (local development)
//   gcp-secret:NAME   GCP Secret Manager (production, added with deployment)

export class DatabaseRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseRefError";
  }
}

export function resolveDatabaseRef(
  ref: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const [kind, name] = ref.split(":", 2);
  if (kind === "env" && name) {
    const url = env[name];
    if (!url) throw new DatabaseRefError(`Environment variable ${name} (from database_ref "${ref}") is not set`);
    assertPostgresUrl(url, name);
    return url;
  }
  if (kind === "gcp-secret") {
    throw new DatabaseRefError(`database_ref "${ref}": GCP Secret Manager refs are not supported yet`);
  }
  throw new DatabaseRefError(`database_ref "${ref}" must look like env:NAME or gcp-secret:NAME`);
}

export function assertPostgresUrl(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DatabaseRefError(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new DatabaseRefError(`${label} must be a postgresql:// URL`);
  }
}

/** "ep-x-pooler.c-15.us-east-1.aws.neon.tech" -> "aws-us-east-1". */
export function neonRegionFromUrl(url: string): string {
  const host = new URL(url).hostname;
  const match = host.match(/\.([a-z]{2}-[a-z]+-\d)\.(aws|azure)\.neon\.tech$/);
  return match ? `${match[2]}-${match[1]}` : "unknown";
}

/** host/database only, safe for logs. */
export function describeUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.pathname}`;
}
