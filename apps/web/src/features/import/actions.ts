"use server";

// One action, two steps: "preview" plans the import and saves nothing;
// "import" plans it again from the same files and saves it in one transaction.
import { revalidatePath } from "next/cache";
import { ForbiddenError, missingColumns, normalizeRows, parseCsv, planImport, ValidationError, type CsvRow, type RowResult } from "@vetrix/domain";
import { importContext, runImport, withTransaction } from "@vetrix/db/runtime";
import { toActionError } from "@/lib/action-result";
import { clinicToday } from "@/lib/clinic-date";
import { requireShell } from "@/lib/session";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 50_000;
const FILES = { clients: "Clients", patients: "Pets", vaccines: "Vaccines" } as const;
type FileKey = keyof typeof FILES;

export type ImportState =
  | { step: "idle" }
  | { step: "error"; error: string }
  | {
      step: "preview" | "done";
      summary: { clientsNew: number; clientsMatched: number; patients: number; patientsMatched: number; vaccines: number; vaccinesMatched: number; errors: number; skipped: number };
      /** Problem rows only (errors and skips), at most 200. */
      issues: RowResult[];
      issueCount: number;
      result?: { clientsCreated: number; petsCreated: number; vaccinesCreated: number; petsDue30d: number };
    };

async function readFile(form: FormData, key: FileKey, required: boolean): Promise<CsvRow[]> {
  const file = form.get(key);
  if (!(file instanceof File) || file.size === 0) {
    if (required) throw new ValidationError(`Choose the ${FILES[key].toLowerCase()} file.`);
    return [];
  }
  if (file.size > MAX_BYTES) throw new ValidationError(`The ${FILES[key].toLowerCase()} file is larger than 10 MB. Split it and import in parts.`);
  if (!/\.csv$/i.test(file.name)) throw new ValidationError(`The ${FILES[key].toLowerCase()} file must be a .csv file.`);
  let rows: CsvRow[];
  try {
    rows = normalizeRows(parseCsv(await file.text()), key);
  } catch (error) {
    throw new ValidationError(`The ${FILES[key].toLowerCase()} file could not be read: ${(error as Error).message}.`);
  }
  if (rows.length > MAX_ROWS) throw new ValidationError(`The ${FILES[key].toLowerCase()} file has more than ${MAX_ROWS.toLocaleString("en-US")} rows.`);
  const missing = missingColumns(rows, key);
  if (rows.length > 0 && missing.length > 0) {
    throw new ValidationError(`The ${FILES[key].toLowerCase()} file is missing these columns: ${missing.join(", ")}.`);
  }
  return rows;
}

export async function importAction(_: ImportState, form: FormData): Promise<ImportState> {
  try {
    const shell = await requireShell();
    if (!shell.permissions.has("clients.manage") || !shell.permissions.has("patients.manage")) throw new ForbiddenError();
    const source = {
      clients: await readFile(form, "clients", true),
      patients: await readFile(form, "patients", true),
      vaccines: await readFile(form, "vaccines", false),
    };
    const today = clinicToday(shell.location.timezone);
    const intent = form.get("intent") === "import" ? "import" : "preview";

    const plan = async (db: Parameters<typeof importContext>[0]) =>
      planImport({ ...source, today, ...(await importContext(db, shell.location.id)) });

    if (intent === "preview") {
      const p = await plan(shell.clinic);
      const issues = p.rows.filter((r) => r.outcome === "error" || r.outcome === "skip");
      return { step: "preview", summary: p.summary, issues: issues.slice(0, 200), issueCount: issues.length };
    }

    const { p, result } = await withTransaction(shell.clinic, async (tx) => {
      const p = await plan(tx);
      const result = await runImport(tx, {
        locationId: shell.location.id,
        today,
        plan: p,
        source,
        actor: { type: "staff", id: shell.access.staffUserId },
      });
      return { p, result };
    });
    revalidatePath("/clients");
    revalidatePath("/patients");
    revalidatePath("/overview");
    const issues = p.rows.filter((r) => r.outcome === "error" || r.outcome === "skip");
    return { step: "done", summary: p.summary, issues: issues.slice(0, 200), issueCount: issues.length, result };
  } catch (error) {
    const r = toActionError(error);
    return { step: "error", error: r.ok ? "Something went wrong." : r.error };
  }
}
