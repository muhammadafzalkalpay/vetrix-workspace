import type { CSSProperties } from "react";
import { ShieldCheck } from "lucide-react";
import { BrandBackdrop, Highlight, LogoOnDark } from "@/components/vetrix/brand-backdrop";
import { BookingScene } from "@/features/auth/booking-scene";

export const dynamic = "force-dynamic";

const delay = (seconds: number): CSSProperties => ({ animationDelay: `${seconds}s` });

/** Form on the right; from large screens up, a booking scene on the left. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-card lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:gap-8 lg:px-12 lg:py-10 xl:px-16">
        <BrandBackdrop />
        <div className="vx-fade-up relative">
          <LogoOnDark />
        </div>

        <div className="relative grid max-w-xl gap-4">
          <p className="vx-fade-up text-display font-semibold" style={delay(0.1)}>
            Every call answered.{" "}
            <Highlight delay={0.9}>Every pet brought back.</Highlight>
          </p>
          <p className="vx-fade-up max-w-md text-h3 font-normal text-white/75" style={delay(0.25)}>
            Owners book online or by phone. Vetrix fills the right slot with the right doctor and room.
          </p>
        </div>

        <div className="relative mt-auto flex justify-center">
          <BookingScene className="origin-bottom scale-90 xl:scale-105 2xl:scale-[1.15]" />
        </div>
      </aside>

      <main className="relative flex flex-col">
        {/* Small screens: a compact brand header in place of the panel. */}
        <div className="relative overflow-hidden px-6 pb-10 pt-6 text-white lg:hidden">
          <BrandBackdrop />
          <div className="relative grid gap-4">
            <LogoOnDark />
            <p className="vx-fade-up text-h2 font-semibold">Every call answered. Every pet brought back.</p>
          </div>
        </div>

        <div className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:px-8">
          <div className="vx-fade-up grid w-full max-w-[400px] gap-8" style={delay(0.15)}>
            {children}
            <p className="flex items-center gap-2 border-t pt-6 text-caption text-muted-foreground">
              <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden />
              Protected sign-in. Each clinic&apos;s data is kept in its own database.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
