// Waitlist claim links: public pages that need no sign-in.
import "server-only";
import { getEnv } from "./env";

export function claimBase(organizationId: string): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/claim/${organizationId}`;
}
