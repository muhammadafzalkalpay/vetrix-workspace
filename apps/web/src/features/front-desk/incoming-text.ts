// One incoming text from a client's mobile, whether it arrived from Twilio or
// was typed in the Sandbox "client replies" box:
// 1. STOP / START (carrier keywords);
// 2. a reply to a text we sent (C, R, REFILL, YES, HELP, moved, post-op worry);
// 3. otherwise, a conversation with the AI front desk.
import "server-only";
import {
  applyTextKeyword,
  continueFrontDesk,
  findOpenTextThread,
  handleClientReply,
  messagingSettings,
  startFrontDesk,
  withTransaction,
  type OutboundText,
} from "@vetrix/db/runtime";
import { formatPhone } from "@vetrix/domain";
import { triageClassifier } from "@/lib/ai";
import type { ClinicPool } from "@/lib/staff-context";

export interface IncomingTextResult {
  /** Texts to send back to this mobile now (TwiML reply in live mode). */
  texts: string[];
  /** Texts for other numbers, sent by REST in live mode. */
  others: OutboundText[];
  /** Riley's messages saved as queued that are now going out in the reply. */
  sentWithReply: OutboundText[];
  /** What happened, for the Sandbox box. */
  notes: string[];
  callId: string | null;
}

export async function processIncomingText(input: { clinic: ClinicPool; locationId: string; mobile: string; body: string; sandbox: boolean }): Promise<IncomingTextResult> {
  const { clinic, locationId, mobile, sandbox } = input;
  const body = input.body.trim().slice(0, 1000);
  const empty: IncomingTextResult = { texts: [], others: [], sentWithReply: [], notes: [], callId: null };
  if (!body) return empty;

  const keyword = await applyTextKeyword(clinic, { locationId, mobile, body });
  if (keyword) return { ...empty, notes: [keyword === "stop" ? "Texts turned off (STOP). The carrier sends the confirmation." : "Texts turned back on (START)."] };

  let text = body;
  const client = (await clinic.query<{ id: string }>(`SELECT id FROM clients WHERE location_id = $1 AND mobile = $2`, [locationId, mobile])).rows[0];
  if (client) {
    const [settings, loc] = await Promise.all([
      messagingSettings(clinic, locationId),
      clinic.query<{ main_phone: string | null }>(`SELECT main_phone FROM locations WHERE id = $1`, [locationId]),
    ]);
    const phone = loc.rows[0]?.main_phone ?? "";
    const outcome = await withTransaction(clinic, async (tx) => {
      const o = await handleClientReply(tx, {
        locationId,
        clientId: client.id,
        text: body,
        values: { clinicName: settings.clinicName, clinicPhone: phone ? safePhone(phone) : "the clinic", timezone: settings.timezone },
      });
      // Our answer is part of the client's message history.
      if (o.handled && o.reply) {
        await tx.query(
          `INSERT INTO messages (location_id, client_id, channel, template_key, body, status, sent_at) VALUES ($1, $2, 'sms', 'reply', $3, $4, now())`,
          [locationId, client.id, o.reply, sandbox ? "simulated" : "sent"],
        );
      }
      return o;
    });
    if (outcome.handled) return { ...empty, texts: outcome.reply ? [outcome.reply] : [], notes: outcome.notes };
    text = outcome.text;
  }

  let callId = await findOpenTextThread(clinic, locationId, mobile);
  if (!callId) callId = (await startFrontDesk(clinic, { locationId, channel: "sms", callerNumber: mobile, sandbox })).callId;
  const r = await continueFrontDesk(clinic, { locationId, callId, text }, Date.now(), { classify: triageClassifier() });
  const forCaller = r.outbound.filter((o) => o.to === mobile);
  return {
    texts: [r.replies.join(" "), ...forCaller.map((o) => o.body)].filter(Boolean),
    others: r.outbound.filter((o) => o.to !== mobile),
    sentWithReply: forCaller,
    notes: r.notes,
    callId,
  };
}

function safePhone(phone: string): string {
  try {
    return formatPhone(phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "")}`);
  } catch {
    return phone;
  }
}
