// Twilio webhook: what the caller said (speech result). Logic lives in features/front-desk/twilio-webhooks.ts.
import { handleCallTurn } from "@/features/front-desk/twilio-webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleCallTurn(request);
}
