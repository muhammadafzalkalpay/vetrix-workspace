// Public waitlist claim page (no sign-in). Shows only the pet's first name,
// the service and the time: nothing else about the client.
import type { Metadata } from "next";
import { offerByToken } from "@vetrix/db/runtime";
import { Alert } from "@/components/ui/alert";
import { BrandBackdrop, LogoOnDark } from "@/components/vetrix/brand-backdrop";
import { ClaimButton } from "@/features/waitlist/claim-button";
import { tenancy } from "@/lib/tenancy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Claim a time · Vetrix", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClaimPage({ params }: { params: Promise<{ org: string; token: string }> }) {
  const { org, token } = await params;
  let offer: Awaited<ReturnType<typeof offerByToken>> = null;
  if (UUID.test(org) && /^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    try {
      offer = await offerByToken((await tenancy().clinicPool(org)).pool, token);
    } catch {
      offer = null;
    }
  }
  const when = offer
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: offer.timezone }).format(offer.start)
    : "";
  const open = offer && offer.status === "sent" && offer.expiresAt.getTime() > Date.now();

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="grid w-full max-w-md overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="relative overflow-hidden px-6 py-6 text-white">
          <BrandBackdrop waves="55%" glow={false} />
          <div className="relative grid gap-3">
            <LogoOnDark />
            <p className="text-h3 font-semibold">{offer ? offer.clinicName : "Claim a time"}</p>
          </div>
        </div>
        <div className="grid gap-4 p-6">
          {!offer ? (
            <Alert variant="warning">This link is not valid. Please reply to the text or call the clinic.</Alert>
          ) : (
            <>
              <div className="grid gap-1">
                <p className="text-small text-muted-foreground">A time opened up for</p>
                <p className="text-h2 font-semibold">{offer.petName}</p>
                <p>{offer.serviceName}</p>
                <p className="font-medium">{when}</p>
              </div>
              {open ? (
                <ClaimButton org={org} token={token} label="Claim this time" />
              ) : (
                <Alert variant="warning">
                  {offer.status === "claimed" ? "This time has already been claimed." : offer.status === "slot_taken" ? "Sorry, someone claimed this time first. You're still on the waitlist." : "This offer has ended. You're still on the waitlist."}
                </Alert>
              )}
              <p className="text-caption text-muted-foreground">First to claim gets it. Offers last 30 minutes.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
