// Twilio webhook: call status updates (hang-up). Logic lives in features/front-desk/twilio-webhooks.ts.
import { handleCallStatus } from "@/features/front-desk/twilio-webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleCallStatus(request);
}
