// Texts and emails with clients: the message log, one client's history, and
// recording a message staff send. Sending itself (Twilio, SendGrid) happens in
// the web app after the record is saved.
import { NotFoundError, type ClientFlag, type MessageChannel } from "@vetrix/domain";
import { writeAudit, type Actor } from "./clients";
import type { SqlClient } from "./sql-client";

export type MessageStatus = "queued" | "simulated" | "sent" | "delivered" | "failed" | "suppressed" | "held";

export interface MessageListItem {
  id: string;
  client_id: string;
  client_name: string;
  mobile: string;
  channel: "sms" | "email" | "ai_call";
  template_key: string;
  subject: string | null;
  body: string;
  status: MessageStatus;
  created_at: Date;
  sent_by_name: string | null;
  replies: number;
}

/** Newest first; search by client name or phone digits. */
export async function listMessages(
  db: SqlClient,
  locationId: string,
  opts: { channel?: "sms" | "email"; q?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: MessageListItem[]; total: number }> {
  const params: unknown[] = [locationId, Math.min(opts.limit ?? 30, 100), opts.offset ?? 0];
  const where: string[] = ["m.location_id = $1"];
  if (opts.channel) where.push(`m.channel = $${params.push(opts.channel)}`);
  const q = opts.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    const i = params.push(`%${q.toLowerCase()}%`);
    const d = params.push(digits.length >= 3 ? `%${digits}%` : "\u0000");
    where.push(`(lower(c.first_name || ' ' || c.last_name) LIKE $${i} OR c.mobile LIKE $${d})`);
  }
  const { rows } = await db.query<MessageListItem & { total: string }>(
    `SELECT m.id, m.client_id, c.first_name || ' ' || c.last_name AS client_name, c.mobile, m.channel, m.template_key, m.subject, m.body,
            m.status, m.created_at, s.display_name AS sent_by_name,
            (SELECT count(*)::int FROM message_replies r WHERE r.message_id = m.id) AS replies,
            count(*) OVER () AS total
     FROM messages m JOIN clients c ON c.id = m.client_id LEFT JOIN staff_users s ON s.id = m.sent_by
     WHERE ${where.join(" AND ")}
     ORDER BY m.created_at DESC LIMIT $2 OFFSET $3`,
    params,
  );
  return { rows: rows.map(({ total: _total, ...r }) => r), total: Number(rows[0]?.total ?? 0) };
}

export interface ThreadClient {
  id: string;
  first_name: string;
  last_name: string;
  mobile: string;
  email: string | null;
  sms_consent: boolean;
  flags: ClientFlag[];
}

export type ThreadItem =
  | { kind: "out"; id: string; channel: "sms" | "email" | "ai_call"; template_key: string; subject: string | null; body: string; status: MessageStatus; at: Date; sent_by_name: string | null; error: string | null }
  | { kind: "in"; id: string; body: string; at: Date };

export interface ClientThread {
  client: ThreadClient;
  items: ThreadItem[];
  /** Text conversations with Riley (shown on the Calls page). */
  conversations: { id: string; started_at: Date; summary: string | null; sandbox: boolean }[];
}

export async function getClientThread(db: SqlClient, locationId: string, clientId: string): Promise<ClientThread> {
  const c = await db.query<ThreadClient>(
    `SELECT c.id, c.first_name, c.last_name, c.mobile, c.email, c.sms_consent,
            coalesce((SELECT array_agg(f.flag ORDER BY f.flag) FROM client_flags f WHERE f.client_id = c.id), '{}') AS flags
     FROM clients c WHERE c.id = $1 AND c.location_id = $2`,
    [clientId, locationId],
  );
  const client = c.rows[0];
  if (!client) throw new NotFoundError("Client", clientId);
  const [out, replies, conversations] = await Promise.all([
    db.query<{ id: string; channel: "sms" | "email" | "ai_call"; template_key: string; subject: string | null; body: string; status: MessageStatus; at: Date; sent_by_name: string | null; error: string | null }>(
      `SELECT m.id, m.channel, m.template_key, m.subject, m.body, m.status, m.created_at AS at, s.display_name AS sent_by_name, m.error
       FROM messages m LEFT JOIN staff_users s ON s.id = m.sent_by
       WHERE m.client_id = $1 AND m.location_id = $2 ORDER BY m.created_at DESC LIMIT 200`,
      [clientId, locationId],
    ),
    db.query<{ id: string; body: string; at: Date }>(
      `SELECT r.id, r.body, r.received_at AS at FROM message_replies r JOIN messages m ON m.id = r.message_id
       WHERE m.client_id = $1 AND m.location_id = $2 ORDER BY r.received_at DESC LIMIT 200`,
      [clientId, locationId],
    ),
    db.query<ClientThread["conversations"][number]>(
      `SELECT id, started_at, summary, sandbox FROM calls WHERE client_id = $1 AND location_id = $2 AND channel = 'sms'
       ORDER BY started_at DESC LIMIT 20`,
      [clientId, locationId],
    ),
  ]);
  const items: ThreadItem[] = [
    ...out.rows.map((m) => ({ kind: "out" as const, ...m })),
    ...replies.rows.map((r) => ({ kind: "in" as const, ...r })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  return { client, items, conversations: conversations.rows };
}

/** Saves a message staff are sending. Sandbox messages are final here ("simulated"). */
export async function recordOutbound(
  db: SqlClient,
  input: { locationId: string; clientId: string; channel: MessageChannel; subject: string | null; body: string; sandbox: boolean; staffUserId: string; actor: Actor },
): Promise<string> {
  const exists = await db.query(`SELECT 1 FROM clients WHERE id = $1 AND location_id = $2`, [input.clientId, input.locationId]);
  if (!exists.rows[0]) throw new NotFoundError("Client", input.clientId);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO messages (location_id, client_id, channel, template_key, subject, body, status, sent_at, sent_by)
     VALUES ($1, $2, $3, 'staff_message', $4, $5, $6, $7, $8) RETURNING id`,
    [input.locationId, input.clientId, input.channel, input.subject, input.body, input.sandbox ? "simulated" : "queued", input.sandbox ? new Date() : null, input.staffUserId],
  );
  const id = rows[0]!.id;
  // The audit log notes that a message was sent, not its content.
  await writeAudit(db, { locationId: input.locationId, actor: input.actor, action: "message.sent", entityType: "message", entityId: id, changes: { channel: input.channel, sandbox: input.sandbox } });
  return id;
}

/** The result of a live send. */
export async function setMessageResult(
  db: SqlClient,
  input: { locationId: string; messageId: string; ok: boolean; providerMessageId: string | null; error?: string | null },
): Promise<void> {
  await db.query(
    `UPDATE messages SET status = $3, provider_message_id = $4, error = $5, sent_at = CASE WHEN $3 = 'sent' THEN now() ELSE sent_at END
     WHERE id = $1 AND location_id = $2`,
    [input.messageId, input.locationId, input.ok ? "sent" : "failed", input.providerMessageId, input.ok ? null : (input.error ?? "Not sent")],
  );
}

/** Quiet hours and time zone for a location. */
export async function messagingSettings(db: SqlClient, locationId: string): Promise<{ timezone: string; quietStart: string; quietEnd: string; clinicName: string }> {
  const { rows } = await db.query<{ timezone: string; name: string; quiet_start: string | null; quiet_end: string | null }>(
    `SELECT l.timezone, l.name, to_char(ms.quiet_start, 'HH24:MI') AS quiet_start, to_char(ms.quiet_end, 'HH24:MI') AS quiet_end
     FROM locations l LEFT JOIN location_messaging_settings ms ON ms.location_id = l.id WHERE l.id = $1`,
    [locationId],
  );
  const r = rows[0];
  if (!r) throw new NotFoundError("Location", locationId);
  return { timezone: r.timezone, clinicName: r.name, quietStart: r.quiet_start ?? "20:00", quietEnd: r.quiet_end ?? "08:00" };
}
