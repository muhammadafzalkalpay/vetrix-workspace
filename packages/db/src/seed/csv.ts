// Reads a CSV file from disk for the sample data. Parsing lives in @vetrix/domain.
import { readFileSync } from "node:fs";
import { parseCsv } from "@vetrix/domain";

export { parseCsv };

export function readCsv(path: string): Record<string, string>[] {
  return parseCsv(readFileSync(path, "utf8"));
}
