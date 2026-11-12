"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { importAction, type ImportState } from "./actions";

const SLOTS = [
  { key: "clients", label: "Clients", hint: "Owners: id, first_name, last_name, mobile", required: true },
  { key: "patients", label: "Pets", hint: "id, client_id, name, species", required: true },
  { key: "vaccines", label: "Vaccines", hint: "patient_id, vaccine_id, administered_at, due_at", required: false },
] as const;
type SlotKey = (typeof SLOTS)[number]["key"];

const FILE_LABEL: Record<string, string> = { clients: "Clients", patients: "Pets", vaccines: "Vaccines" };

function FileSlot({ slot, file, onChange }: { slot: (typeof SLOTS)[number]; file?: File; onChange: (f?: File) => void }) {
  return (
    <div className={cn("grid gap-3 rounded-xl border-2 border-dashed bg-card p-5 transition-colors", file ? "border-primary/50 bg-secondary/40" : "border-border")}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          <FileSpreadsheet className="size-5 text-primary" aria-hidden />
          {slot.label}
        </span>
        <Badge variant={slot.required ? "secondary" : "muted"}>{slot.required ? "Required" : "Optional"}</Badge>
      </div>
      <p className="text-caption text-muted-foreground">{slot.hint}</p>
      {file ? (
        <div className="flex items-center justify-between gap-2 rounded-md bg-card px-3 py-2 text-small">
          <span className="truncate font-medium">{file.name}</span>
          <button type="button" onClick={() => onChange(undefined)} aria-label={`Remove ${slot.label} file`} className="cursor-pointer rounded-full p-1 hover:bg-muted">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <label className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit cursor-pointer")}>
          <Upload aria-hidden /> Choose CSV
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onChange(e.target.files?.[0])} />
        </label>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-card">
      <p
        className={cn(
          "text-h2 font-semibold tabular-nums",
          tone === "good" && "text-success-text",
          tone === "warn" && "text-warning-text",
          tone === "bad" && "text-destructive",
        )}
      >
        {value.toLocaleString("en-US")}
      </p>
      <p className="text-small text-muted-foreground">{label}</p>
    </div>
  );
}

export function ImportWizard() {
  const [files, setFiles] = useState<Partial<Record<SlotKey, File>>>({});
  const [state, dispatch] = useActionState(importAction, { step: "idle" } as ImportState);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<"preview" | "import" | null>(null);
  // Import is only allowed for exactly the files that were previewed.
  const [version, setVersion] = useState(0);
  const [previewedVersion, setPreviewedVersion] = useState(-1);

  // Files are kept in state and sent by hand, so a preview never clears them.
  const send = (intent: "preview" | "import") => {
    const form = new FormData();
    form.set("intent", intent);
    for (const [k, f] of Object.entries(files)) if (f) form.set(k, f);
    setRunning(intent);
    if (intent === "preview") setPreviewedVersion(version);
    startTransition(() => dispatch(form));
  };
  const setFile = (key: SlotKey, f?: File) => {
    setFiles((prev) => ({ ...prev, [key]: f }));
    setVersion((v) => v + 1);
  };
  const ready = Boolean(files.clients && files.patients);
  const done = state.step === "done";
  const stale = state.step === "preview" && previewedVersion !== version;
  const preview = (state.step === "preview" && !stale) || done ? (state as Extract<ImportState, { summary: unknown }>) : null;

  return (
    <div className="grid gap-6">
      {!done && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {SLOTS.map((slot) => (
              <FileSlot key={slot.key} slot={slot} file={files[slot.key]} onChange={(f) => setFile(slot.key, f)} />
            ))}
          </div>
          <p className="text-small text-muted-foreground">
            Export these from your practice software as CSV. Column names like “Phone”, “First Name” or “DOB” are recognised. Nothing is saved until you
            press Import.
          </p>
        </>
      )}

      {state.step === "error" && (
        <Alert variant="error">
          <AlertCircle aria-hidden />
          <p>{state.error}</p>
        </Alert>
      )}

      {preview && (
        <section aria-live="polite" className="grid gap-4">
          {done && state.result ? (
            <Alert variant="success">
              <CheckCircle2 aria-hidden />
              <div className="grid gap-1">
                <p className="font-semibold">Import complete</p>
                <p>
                  {state.result.clientsCreated} clients, {state.result.petsCreated} pets and {state.result.vaccinesCreated} vaccine records added.{" "}
                  {state.result.petsDue30d > 0 && <strong>{state.result.petsDue30d} pets are due for care in the next 30 days.</strong>}
                </p>
              </div>
            </Alert>
          ) : (
            <h3 className="text-h3">Preview: nothing is saved yet</h3>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="New clients" value={preview.summary.clientsNew} tone="good" />
            <Stat label="Clients already here" value={preview.summary.clientsMatched} />
            <Stat label="New pets" value={preview.summary.patients} tone="good" />
            <Stat label="New vaccine records" value={preview.summary.vaccines} tone="good" />
          </div>
          {preview.summary.clientsNew + preview.summary.patients + preview.summary.vaccines === 0 && !done && (
            <Alert variant="info">
              <CheckCircle2 aria-hidden />
              <p>Everything in these files is already in Vetrix. There is nothing new to import.</p>
            </Alert>
          )}
          {preview.summary.patientsMatched > 0 && (
            <p className="text-small text-muted-foreground">
              {preview.summary.patientsMatched} pets are already on file and will be kept as they are
              {preview.summary.vaccinesMatched > 0 ? `, and ${preview.summary.vaccinesMatched} of their vaccine records are already recorded` : ""}. Only new
              records are added.
            </p>
          )}

          {preview.issueCount > 0 && (
            <div className="grid gap-2 rounded-xl border bg-card p-5 shadow-card">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">Rows that will not be imported</h3>
                {preview.summary.errors > 0 && <Badge variant="danger">{preview.summary.errors} with errors</Badge>}
                {preview.summary.skipped > 0 && <Badge variant="warning">{preview.summary.skipped} skipped</Badge>}
              </div>
              <p className="text-small text-muted-foreground">
                Fix these in your file and import again later; rows already imported are recognised and not duplicated.
              </p>
              <div className="-mx-1 max-h-96 overflow-auto">
                <table className="w-full min-w-[560px] text-small">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b text-left text-caption uppercase tracking-wider text-muted-foreground">
                      <th className="px-1 py-2 font-medium">File</th>
                      <th className="px-1 py-2 font-medium">Row</th>
                      <th className="px-1 py-2 font-medium">Id</th>
                      <th className="px-1 py-2 font-medium">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.issues.map((r) => (
                      <tr key={`${r.file}-${r.rowNumber}`} className="border-b align-top last:border-0">
                        <td className="px-1 py-2">{FILE_LABEL[r.file]}</td>
                        <td className="px-1 py-2 tabular-nums">{r.rowNumber}</td>
                        <td className="px-1 py-2 font-mono text-caption">{r.sourceId}</td>
                        <td className={cn("px-1 py-2", r.outcome === "error" ? "text-destructive" : "text-warning-text")}>{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.issueCount > preview.issues.length && (
                <p className="text-caption text-muted-foreground">Showing the first {preview.issues.length} of {preview.issueCount}.</p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {done ? (
          <>
            <Link href="/patients" className={buttonVariants({ variant: "outline" })}>
              View patients
            </Link>
            <Link href="/clients" className={buttonVariants()}>
              View clients
            </Link>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" disabled={!ready || pending} onClick={() => send("preview")}>
              {pending && running === "preview" && <Loader2 className="animate-spin" aria-hidden />}
              Preview
            </Button>
            <Button
              type="button"
              disabled={
                !ready ||
                pending ||
                !preview ||
                (preview.summary.clientsNew === 0 && preview.summary.patients === 0 && preview.summary.vaccines === 0)
              }
              onClick={() => send("import")}
            >
              {pending && running === "import" && <Loader2 className="animate-spin" aria-hidden />}
              {pending && running === "import" ? "Importing" : "Import"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
