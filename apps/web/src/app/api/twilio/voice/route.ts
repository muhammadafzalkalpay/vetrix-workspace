// Twilio webhook: incoming phone call. Logic lives in features/front-desk/twilio-webhooks.ts.
import { handleIncomingCall } from "@/features/front-desk/twilio-webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleIncomingCall(request);
}
