// Twilio webhook: result of a warm transfer. Logic lives in features/front-desk/twilio-webhooks.ts.
import { handleDialResult } from "@/features/front-desk/twilio-webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleDialResult(request);
}
