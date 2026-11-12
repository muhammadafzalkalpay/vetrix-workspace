// Turns raw JSON into a checked Pack. Any problem lists every issue at once
// (file, path, message) so a pack author can fix them in one pass.
import { checkReferences, type PackIssue } from "./references";
import { manifestSchema, packFileSchemas, PACK_FILE_KEYS, type Pack, type PackFileKey } from "./schema";

export class PackValidationError extends Error {
  constructor(readonly issues: PackIssue[]) {
    super(
      `Pack is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n` +
        issues.map((i) => `  ${i.file}: ${i.path}: ${i.message}`).join("\n"),
    );
    this.name = "PackValidationError";
  }
}

export type RawPack = { manifest: unknown } & Partial<Record<PackFileKey, unknown>>;

export function validatePack(raw: RawPack): Pack {
  const issues: PackIssue[] = [];

  const manifest = manifestSchema.safeParse(raw.manifest);
  if (!manifest.success) {
    for (const e of manifest.error.issues) issues.push({ file: "manifest", path: e.path.join("."), message: e.message });
    throw new PackValidationError(issues);
  }

  const parsed: Partial<Pack> = { manifest: manifest.data };
  for (const key of PACK_FILE_KEYS) {
    if (!manifest.data.files.includes(key)) {
      issues.push({ file: "manifest", path: "files", message: `"${key}" is required` });
      continue;
    }
    if (raw[key] === undefined) {
      issues.push({ file: key, path: "", message: "file is missing" });
      continue;
    }
    const result = packFileSchemas[key].safeParse(raw[key]);
    if (result.success) {
      (parsed as Record<string, unknown>)[key] = result.data;
    } else {
      for (const e of result.error.issues) issues.push({ file: key, path: e.path.join("."), message: e.message });
    }
  }
  if (issues.length > 0) throw new PackValidationError(issues);

  const pack = parsed as Pack;
  const refIssues = checkReferences(pack);
  if (refIssues.length > 0) throw new PackValidationError(refIssues);
  return pack;
}
