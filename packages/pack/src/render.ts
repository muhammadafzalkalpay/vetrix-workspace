// Fills {{placeholders}} in pack templates. A message with a missing value
// is never sent half-filled ("Hi , Bella is due"): rendering fails instead.

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export type TemplateValues = Record<string, string | number | null | undefined>;

export class MissingPlaceholderError extends Error {
  constructor(readonly missing: string[]) {
    super(`Template is missing values for: ${missing.join(", ")}`);
    this.name = "MissingPlaceholderError";
  }
}

export function placeholdersIn(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
}

export function renderTemplate(template: string, values: TemplateValues): string {
  const missing = placeholdersIn(template).filter((name) => {
    const v = values[name];
    return v === undefined || v === null || String(v).trim() === "";
  });
  if (missing.length > 0) throw new MissingPlaceholderError(missing);
  return template.replace(PLACEHOLDER, (_, name: string) => String(values[name]));
}
