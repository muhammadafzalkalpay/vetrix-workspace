// Better Auth endpoints: /api/auth/sign-in/email, /api/auth/sign-out, etc.
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return toNextJsHandler(auth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(auth()).POST(request);
}
