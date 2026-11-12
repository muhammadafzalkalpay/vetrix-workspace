import type { CSSProperties } from "react";
import { ShieldCheck } from "lucide-react";
import { Logo } from "@/components/vetrix/logo";
import { BookingScene } from "@/features/auth/booking-scene";

export const dynamic = "force-dynamic";

const delay = (seconds: number): CSSProperties => ({ animationDelay: `${seconds}s` });

/** Light logo for the dark panel. */
function LogoOnDark() {
  return <Logo className="text-white [&_g]:fill-navy-800 [&_path]:stroke-white [&_rect]:fill-white" />;
}

/** One wave, drawn twice side by side so it can drift sideways without a seam. */
function Wave({ className, d }: { className: string; d: string }) {
  return (
    <svg viewBox="0 0 1600 200" preserveAspectRatio="none" className={`absolute bottom-0 left-0 h-full w-[200%] ${className}`}>
      <path d={d} />
      <path d={d} transform="translate(800 0)" />
    </svg>
  );
}

const WAVE_A = "M0 120 C 130 70, 270 70, 400 110 S 670 160, 800 120 V200 H0 Z";
const WAVE_B = "M0 140 C 150 100, 260 170, 400 140 S 650 100, 800 140 V200 H0 Z";

/** Calm navy gradient with soft teal waves along the bottom. */
function BrandBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-navy-950 via-navy-800 to-navy-700" />
      <div className="absolute -right-40 -top-40 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.18),transparent_65%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[38%]">
        <Wave className="vx-drift-slow fill-primary/25" d={WAVE_A} />
        <Wave className="vx-drift fill-accent/15" d={WAVE_B} />
      </div>
    </div>
  );
}

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
            <span className="relative inline-block whitespace-nowrap">
              Every pet brought back.
              <svg
                className="absolute -bottom-2 left-0 h-3 w-full text-highlight"
                viewBox="0 0 300 12"
                preserveAspectRatio="none"
                fill="none"
              >
                <path
                  pathLength={1}
                  className="vx-draw"
                  style={{ ...delay(0.9), animationDuration: "1.1s" }}
                  d="M3 9 C 70 3, 150 3, 297 7"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray="1"
                />
              </svg>
            </span>
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
