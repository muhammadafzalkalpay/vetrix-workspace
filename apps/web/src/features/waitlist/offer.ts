// After staff cancel or move a visit: offer the freed time to the waitlist.
// Never blocks the cancellation itself; a failure is logged.
import "server-only";
import { aiPersonaName, messagingSettings, offerFreedSlot, queuedMessages, withTransaction } from "@vetrix/db/runtime";
import { claimBase } from "@/lib/claim";
import { getMessagingMode } from "@/lib/env";
import { logger } from "@/lib/logger";
import { deliverQueued } from "@/lib/outbound";
import type { ShellContext } from "@/lib/session";

export async function offerFreedTime(shell: ShellContext, appointmentId: string): Promise<number> {
  try {
    const loc = shell.location.id;
    const sandbox = getMessagingMode() === "sandbox";
    const [settings, aiName] = await Promise.all([messagingSettings(shell.clinic, loc), aiPersonaName(shell.clinic, loc)]);
    const { offers } = await withTransaction(shell.clinic, (tx) =>
      offerFreedSlot(tx, {
        locationId: loc,
        appointmentId,
        now: Date.now(),
        sandbox,
        values: { clinicName: settings.clinicName, aiName, timezone: settings.timezone, claimBase: claimBase(shell.organization.organization_id) },
      }),
    );
    if (offers && !sandbox) {
      await deliverQueued({ clinic: shell.clinic, organizationId: shell.organization.organization_id, locationId: loc, clinicName: settings.clinicName, messages: await queuedMessages(shell.clinic, loc) });
    }
    return offers;
  } catch (error) {
    logger.error("waitlist offer failed", { error });
    return 0;
  }
}
