// Client email through SendGrid (plain text). Sign-in emails use auth-email.ts.
import "server-only";

export interface EmailResult {
  ok: boolean;
  id: string | null;
  status: number;
}

export async function sendEmail(
  config: { apiKey: string; from: string; fromName: string },
  input: { to: string; subject: string; text: string; replyTo?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<EmailResult> {
  const res = await fetchImpl("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.to }] }],
      from: { email: config.from, name: config.fromName },
      ...(input.replyTo ? { reply_to: { email: input.replyTo } } : {}),
      subject: input.subject,
      content: [{ type: "text/plain", value: input.text }],
    }),
  });
  return { ok: res.ok, id: res.headers.get("x-message-id"), status: res.status };
}
