// The Vetrix navy surface used on sign-in, the sidebar and page heroes:
// a navy gradient, one soft teal glow and teal waves drifting along the
// bottom. Decorative; still with reduced motion.
import { Logo } from "@/components/vetrix/logo";
import { cn } from "@/lib/utils";

/** One wave, drawn twice side by side so it can drift sideways without a seam. */
function Wave({ className, d }: { className: string; d: string }) {
  return (
    <svg viewBox="0 0 1600 200" preserveAspectRatio="none" className={cn("absolute bottom-0 left-0 h-full w-[200%]", className)}>
      <path d={d} />
      <path d={d} transform="translate(800 0)" />
    </svg>
  );
}

const WAVE_A = "M0 120 C 130 70, 270 70, 400 110 S 670 160, 800 120 V200 H0 Z";
const WAVE_B = "M0 140 C 150 100, 260 170, 400 140 S 650 100, 800 140 V200 H0 Z";

export function BrandBackdrop({ waves = "38%", glow = true }: { waves?: string; glow?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-navy-950 via-navy-800 to-navy-700" />
      {glow && (
        <div className="absolute -right-40 -top-40 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.18),transparent_65%)]" />
      )}
      <div className="absolute inset-x-0 bottom-0" style={{ height: waves }}>
        <Wave className="vx-drift-slow fill-primary/25" d={WAVE_A} />
        <Wave className="vx-drift fill-accent/15" d={WAVE_B} />
      </div>
    </div>
  );
}

/** White logo for navy surfaces. */
export function LogoOnDark({ className }: { className?: string }) {
  return <Logo className={cn("text-white [&_g]:fill-navy-800 [&_path]:stroke-white [&_rect]:fill-white", className)} />;
}

/** Amber hand-drawn underline that draws itself under a word or phrase. */
export function Highlight({ children, delay = 0.6 }: { children: React.ReactNode; delay?: number }) {
  return (
    <span className="relative inline-block whitespace-nowrap">
      {children}
      <svg aria-hidden className="absolute -bottom-2 left-0 h-3 w-full text-highlight" viewBox="0 0 300 12" preserveAspectRatio="none" fill="none">
        <path
          pathLength={1}
          className="vx-draw"
          style={{ animationDelay: `${delay}s`, animationDuration: "1.1s" }}
          d="M3 9 C 70 3, 150 3, 297 7"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="1"
        />
      </svg>
    </span>
  );
}
