// Every term shown to staff or owners comes from labels.json, so a future
// vertical (dental, physio) changes the words without changing screens.
import type { Pack } from "./schema";

export class MissingLabelError extends Error {
  constructor(readonly key: string) {
    super(`Missing label "${key}" in labels.json`);
    this.name = "MissingLabelError";
  }
}

export function findLabel(labels: Pack["labels"]["labels"], key: string): string | undefined {
  let node: unknown = labels;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Looks up a label such as "provider_role.dvm". Throws if it is missing. */
export function label(pack: Pick<Pack, "labels">, key: string): string {
  const value = findLabel(pack.labels.labels, key);
  if (value === undefined) throw new MissingLabelError(key);
  return value;
}
