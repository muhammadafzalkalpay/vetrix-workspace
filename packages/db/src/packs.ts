// Publishes a validated pack into the registry (verticals, config_packs,
// config_pack_files). A published version never changes: publishing the same
// version again with different content is refused, so every clinic on that
// version keeps exactly the rules it was configured with.
import { packFileChecksum } from "@vetrix/pack/checksum";
import { validatePack, type RawPack } from "@vetrix/pack";
import type { SqlClient } from "./migrations";

/** Verticals offered in the signup selector. Only veterinary is enabled today. */
export const VERTICALS = [
  { id: "veterinary", name: "Veterinary clinic", status: "active" },
  { id: "med_spa", name: "Med spa", status: "coming_soon" },
  { id: "dental", name: "Dental", status: "coming_soon" },
  { id: "physical_therapy", name: "Physical therapy", status: "coming_soon" },
  { id: "chiropractic", name: "Chiropractic", status: "coming_soon" },
] as const;

export class PackPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackPublishError";
  }
}

export interface PublishResult {
  configPackId: string;
  version: string;
  created: boolean;
}

export async function publishPack(registry: SqlClient, raw: RawPack): Promise<PublishResult> {
  const pack = validatePack(raw); // never publish an invalid pack
  const { vertical_id, pack_version, schema_version, files } = pack.manifest;
  const contents = Object.fromEntries(files.map((key) => [key, raw[key]]));
  const checksums = Object.fromEntries(files.map((key) => [key, packFileChecksum(contents[key])]));

  await registry.query("BEGIN");
  try {
    for (const v of VERTICALS) {
      await registry.query(
        `INSERT INTO verticals (id, name, status) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status`,
        [v.id, v.name, v.status],
      );
    }

    const existing = await registry.query<{ id: string }>(
      `SELECT id FROM config_packs WHERE vertical_id = $1 AND pack_version = $2`,
      [vertical_id, pack_version],
    );
    if (existing.rows[0]) {
      const id = existing.rows[0].id;
      const stored = await registry.query<{ file_key: string; checksum: string }>(
        `SELECT file_key, checksum FROM config_pack_files WHERE config_pack_id = $1`,
        [id],
      );
      const storedMap = Object.fromEntries(stored.rows.map((r) => [r.file_key, r.checksum]));
      const changed = files.filter((key) => storedMap[key] !== checksums[key]);
      if (changed.length > 0 || stored.rows.length !== files.length) {
        throw new PackPublishError(
          `${vertical_id} ${pack_version} is already published with different content ` +
            `(${changed.join(", ") || "file list"}). Bump pack_version in manifest.json instead.`,
        );
      }
      await registry.query("COMMIT");
      return { configPackId: id, version: pack_version, created: false };
    }

    const inserted = await registry.query<{ id: string }>(
      `INSERT INTO config_packs (vertical_id, pack_version, schema_version, status)
       VALUES ($1, $2, $3, 'published') RETURNING id`,
      [vertical_id, pack_version, schema_version],
    );
    const id = inserted.rows[0]!.id;
    for (const key of files) {
      await registry.query(
        `INSERT INTO config_pack_files (config_pack_id, file_key, content, checksum) VALUES ($1, $2, $3, $4)`,
        [id, key, JSON.stringify(contents[key]), checksums[key]],
      );
    }
    await registry.query("COMMIT");
    return { configPackId: id, version: pack_version, created: true };
  } catch (error) {
    await registry.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function latestPublishedPack(
  registry: SqlClient,
  verticalId: string,
): Promise<{ id: string; pack_version: string } | undefined> {
  const { rows } = await registry.query<{ id: string; pack_version: string }>(
    `SELECT id, pack_version FROM config_packs
     WHERE vertical_id = $1 AND status = 'published'
     ORDER BY string_to_array(pack_version, '.')::int[] DESC LIMIT 1`,
    [verticalId],
  );
  return rows[0];
}
