"use server";

// "Try Riley in your browser" on the public home page: no sign-in, so it is
// fenced in on every side.
// - Only the sample clinic named by PUBLIC_SANDBOX_ORG; unset means off.
// - Always Sandbox: nothing is sent to any phone.
// - A visitor can only continue conversations their own browser started
//   (httpOnly cookie), and is rate limited by IP address.
import { cookies, headers } from "next/headers";
import { formatPhone } from "@vetrix/domain";
import { aiPersonaName, continueFrontDesk, endFrontDesk, searchClients, startFrontDesk } from "@vetrix/db/runtime";
import type { ConsoleResult } from "@/features/front-desk/actions";
import type { QuickCaller } from "@/features/front-desk/sandbox-console";
import { triageClassifier } from "@/lib/ai";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createLimiter } from "@/lib/rate-limit";
import { tenancy } from "@/lib/tenancy";

const COOKIE = "vetrix.try";
const MAX_TEXT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const g = globalThis as unknown as { vetrixTryLimits?: { starts: ReturnType<typeof createLimiter>; messages: ReturnType<typeof createLimiter>; all: ReturnType<typeof createLimiter> } };
g.vetrixTryLimits ??= {
  starts: createLimiter({ limit: 6, windowMs: 60 * 60_000 }), // conversations per visitor per hour
  messages: createLimiter({ limit: 40, windowMs: 10 * 60_000 }), // messages per visitor per 10 minutes
  all: createLimiter({ limit: 600, windowMs: 10 * 60_000 }), // everyone together, protects the database
};
const limits = g.vetrixTryLimits;

const busy: ConsoleResult = { ok: false, error: "Riley is very busy right now. Please try again in a few minutes." };

async function visitor(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** The sample clinic and its location, or null when the trial is off. */
async function sampleClinic() {
  const org = getEnv().PUBLIC_SANDBOX_ORG;
  if (!org) return null;
  const { pool } = await tenancy().clinicPool(org);
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM locations WHERE status <> 'closed' ORDER BY name LIMIT 1`);
  return rows[0] ? { pool, locationId: rows[0].id } : null;
}

async function ownedCalls(): Promise<string[]> {
  return ((await cookies()).get(COOKIE)?.value ?? "").split(",").filter((x) => UUID.test(x));
}

/** For the page: whether the trial is on, the AI's name and a few sample clients to pick from. */
export async function publicTrialSetup(): Promise<{ enabled: boolean; aiName: string; callers: QuickCaller[] }> {
  try {
    const clinic = await sampleClinic();
    if (!clinic) return { enabled: false, aiName: "Riley", callers: [] };
    const [aiName, clients] = await Promise.all([aiPersonaName(clinic.pool, clinic.locationId), searchClients(clinic.pool, clinic.locationId, { limit: 4 })]);
    return {
      enabled: true,
      aiName,
      callers: clients.rows.map((c) => ({
        name: `${c.first_name} ${c.last_name}`,
        mobile: c.mobile,
        display: formatPhone(c.mobile),
        pets: c.pets.filter((p) => p.status === "active").map((p) => p.name),
      })),
    };
  } catch (error) {
    logger.error("public trial unavailable", { error });
    return { enabled: false, aiName: "Riley", callers: [] };
  }
}

export async function startPublicAction(input: { channel: "voice" | "sms"; callerNumber: string }): Promise<ConsoleResult> {
  try {
    const who = await visitor();
    if (!limits.starts.take(who) || !limits.all.take("all")) return busy;
    const clinic = await sampleClinic();
    if (!clinic) return { ok: false, error: "The browser trial is not available right now." };
    const r = await startFrontDesk(clinic.pool, {
      locationId: clinic.locationId,
      channel: input.channel === "voice" ? "voice" : "sms",
      callerNumber: String(input.callerNumber ?? "").slice(0, 30),
      sandbox: true,
    });
    const owned = [r.callId, ...(await ownedCalls())].slice(0, 5);
    (await cookies()).set(COOKIE, owned.join(","), { httpOnly: true, sameSite: "lax", secure: getEnv().NODE_ENV === "production", maxAge: 6 * 60 * 60, path: "/" });
    return { ok: true, ...r };
  } catch (error) {
    const message = error instanceof Error && error.name === "ValidationError" ? (error as Error & { userMessage?: string }).userMessage ?? error.message : null;
    if (!message) logger.error("public trial start failed", { error });
    return { ok: false, error: message ?? "Something went wrong. Please try again." };
  }
}

export async function sendPublicAction(callId: string, text: string): Promise<ConsoleResult> {
  try {
    const who = await visitor();
    if (!limits.messages.take(who) || !limits.all.take("all")) return busy;
    if (!(await ownedCalls()).includes(callId)) return { ok: false, error: "This conversation has expired. Please start a new one." };
    const body = String(text ?? "").trim().slice(0, MAX_TEXT);
    if (!body) return { ok: false, error: "Type a message." };
    const clinic = await sampleClinic();
    if (!clinic) return { ok: false, error: "The browser trial is not available right now." };
    const r = await continueFrontDesk(clinic.pool, { locationId: clinic.locationId, callId, text: body }, Date.now(), { classify: triageClassifier() });
    return { ok: true, ...r };
  } catch (error) {
    logger.error("public trial message failed", { error });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function endPublicAction(callId: string): Promise<void> {
  if (!(await ownedCalls()).includes(callId)) return;
  const clinic = await sampleClinic();
  if (clinic) await endFrontDesk(clinic.pool, { locationId: clinic.locationId, callId });
}
