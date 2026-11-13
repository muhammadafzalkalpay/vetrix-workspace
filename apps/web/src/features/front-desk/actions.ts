"use server";

// Server actions for the AI front desk screens: the sandbox console (talk to
// Riley as a client would) and staff tasks. Console conversations are always
// Sandbox: nothing is sent to a real phone, whatever MESSAGING_MODE says.
// Console actions do not revalidate: the Calls and Tasks pages are rendered
// fresh on every visit, and re-rendering the console after each message
// would only slow the reply down.
import { revalidatePath } from "next/cache";
import { ForbiddenError, ValidationError, type Permission, type TriageLevel } from "@vetrix/domain";
import { continueFrontDesk, endFrontDesk, setTaskStatus, startFrontDesk, withTransaction, type Actor } from "@vetrix/db/runtime";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { triageClassifier } from "@/lib/ai";
import { claimBase } from "@/lib/claim";
import { requireShell } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function allowed(...permissions: Permission[]) {
  const shell = await requireShell();
  for (const p of permissions) if (!shell.permissions.has(p)) throw new ForbiddenError();
  const actor: Actor = { type: "staff", id: shell.access.staffUserId };
  return { shell, actor };
}

export type ConsoleResult =
  | { ok: true; callId: string; replies: string[]; notes: string[]; ended: boolean; triageLevel: TriageLevel }
  | { ok: false; error: string };

function failure(error: unknown): ConsoleResult {
  const r = toActionError(error);
  return { ok: false, error: r.ok ? "Something went wrong." : r.error };
}

/** The console books and creates clients, so it needs the same rights as staff booking. */
const CONSOLE: Permission[] = ["calls.view", "schedule.manage"];

export async function startSandboxAction(input: { channel: "voice" | "sms"; callerNumber: string }): Promise<ConsoleResult> {
  try {
    const { shell } = await allowed(...CONSOLE);
    const channel = input.channel === "voice" ? "voice" : "sms";
    if (!input.callerNumber?.trim()) throw new ValidationError("Enter the caller's mobile number.", { field: "callerNumber" });
    const r = await startFrontDesk(shell.clinic, { locationId: shell.location.id, channel, callerNumber: input.callerNumber, sandbox: true });
    return { ok: true, ...r };
  } catch (error) {
    return failure(error);
  }
}

export async function sendSandboxAction(callId: string, text: string): Promise<ConsoleResult> {
  try {
    const { shell } = await allowed(...CONSOLE);
    if (!UUID.test(callId)) throw new ValidationError("Start a conversation first.");
    if (typeof text !== "string") throw new ValidationError("Type a message.");
    const r = await continueFrontDesk(shell.clinic, { locationId: shell.location.id, callId, text }, Date.now(), { classify: triageClassifier(), claimBase: claimBase(shell.organization.organization_id) });
    return { ok: true, ...r };
  } catch (error) {
    return failure(error);
  }
}

export async function endSandboxAction(callId: string): Promise<void> {
  const { shell } = await allowed(...CONSOLE);
  if (!UUID.test(callId)) return;
  await endFrontDesk(shell.clinic, { locationId: shell.location.id, callId });
}

export async function taskStatusAction(taskId: string, status: "open" | "done"): Promise<ActionResult> {
  try {
    const { shell, actor } = await allowed("tasks.manage");
    if (!UUID.test(taskId)) throw new ValidationError("Choose a task.");
    await withTransaction(shell.clinic, (tx) =>
      setTaskStatus(tx, {
        locationId: shell.location.id,
        taskId,
        status: status === "done" ? "done" : "open",
        actor,
        canControlled: shell.permissions.has("tasks.controlled_substances"),
      }),
    );
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/tasks");
  revalidatePath("/overview");
  return { ok: true, message: status === "done" ? "Marked done." : "Reopened." };
}
