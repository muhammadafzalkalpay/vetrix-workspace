// Finds terms from the med spa product (Aesthetix) that must never appear in
// Vetrix screens, emails or texts. Matching is whole-word and case-insensitive,
// so "spa" is caught but "spay" is not.

export interface ForbiddenMatch {
  term: string;
  index: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function forbiddenTermMatcher(terms: readonly string[]): (text: string) => ForbiddenMatch[] {
  if (terms.length === 0) return () => [];
  // Longest first, so "med spa" is reported instead of "spa".
  const alternatives = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((t) => escapeRegExp(t).replace(/\s+/g, "\\s+"));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return (text) =>
    [...text.matchAll(pattern)].map((m) => ({ term: m[0].toLowerCase(), index: m.index ?? 0 }));
}

export function findForbiddenTerms(text: string, terms: readonly string[]): ForbiddenMatch[] {
  return forbiddenTermMatcher(terms)(text);
}

export interface PackTermViolation {
  file: string;
  path: string;
  term: string;
  text: string;
}

/** Scans every string in the pack files, except the forbidden list itself. */
export function scanForForbiddenTerms(
  files: Record<string, unknown>,
  terms: readonly string[],
): PackTermViolation[] {
  const match = forbiddenTermMatcher(terms);
  const found: PackTermViolation[] = [];
  const walk = (file: string, value: unknown, path: string[]) => {
    if (typeof value === "string") {
      for (const m of match(value)) found.push({ file, path: path.join("."), term: m.term, text: value });
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(file, v, [...path, String(i)]));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (file === "labels" && path.length === 0 && k === "forbidden_terms") continue;
        walk(file, v, [...path, k]);
      }
    }
  };
  for (const [file, content] of Object.entries(files)) walk(file, content, []);
  return found;
}
