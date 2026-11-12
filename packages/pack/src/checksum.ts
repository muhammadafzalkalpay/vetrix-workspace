// Server-only: a stable checksum per pack file for config_pack_files.checksum.
// Key order does not change the checksum, so reformatting a file is harmless.
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function packFileChecksum(content: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(content)).digest("hex")}`;
}
