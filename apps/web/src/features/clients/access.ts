import { notFound } from "next/navigation";
import type { Permission } from "@vetrix/domain";
import { requireShell } from "@/lib/session";

/**
 * For pages: the shell, or a 404 when the person lacks the permission. A 404
 * (not 403) avoids confirming that a record exists to someone who cannot see it.
 */
export async function requirePage(permission: Permission) {
  const shell = await requireShell();
  if (!shell.permissions.has(permission)) notFound();
  return shell;
}

/** Ids come from the URL; reject anything that is not a UUID before it reaches Postgres. */
export function assertId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return id;
}

/** Loads a record, turning "not found" (or "not at this location") into a 404 page. */
export async function orNotFound<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundError") notFound();
    throw error;
  }
}
