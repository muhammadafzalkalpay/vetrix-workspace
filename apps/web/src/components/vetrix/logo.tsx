import { cn } from "@/lib/utils";

/** Glyph: a rounded paw whose centre pad carries a heartbeat line. */
export function LogoGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden focusable="false">
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <g className="fill-primary-foreground">
        <ellipse cx="9.5" cy="12" rx="2.4" ry="3" />
        <ellipse cx="14" cy="8.6" rx="2.4" ry="3" />
        <ellipse cx="18.8" cy="8.6" rx="2.4" ry="3" />
        <ellipse cx="23" cy="12" rx="2.4" ry="3" />
        <path d="M16.2 13.6c4.6 0 8 3.6 8 7.4 0 3-2.3 4.4-4.6 4.4-1.4 0-2.3-.6-3.4-.6s-2 .6-3.4.6c-2.3 0-4.6-1.4-4.6-4.4 0-3.8 3.4-7.4 8-7.4Z" />
      </g>
      <path
        d="M10.6 20.4h2.6l1.3-2.4 2 4.6 1.4-2.2h3.6"
        fill="none"
        className="stroke-primary"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoGlyph />
      <span className="text-h3 font-semibold tracking-tight">Vetrix</span>
    </span>
  );
}
