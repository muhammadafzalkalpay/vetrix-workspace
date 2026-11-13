// Twilio webhook: incoming text message. Logic lives in features/front-desk/twilio-webhooks.ts.
import { handleIncomingText } from "@/features/front-desk/twilio-webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleIncomingText(request);
}
