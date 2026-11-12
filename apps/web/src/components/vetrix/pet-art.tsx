// Original flat pet artwork used on the sign-in page. Decorative only:
// the dog's tail wags and both pets blink; still with reduced motion.
import type { CSSProperties } from "react";

const INK = "#0b1b2b";
const delay = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

export function CatArt({ className }: { className?: string }) {
  return (
    <svg viewBox="60 92 110 162" className={className} aria-hidden focusable="false">
      <path d="M124 246c34 0 44-10 40-44" fill="none" stroke="#94a3b8" strokeWidth="10" strokeLinecap="round" />
      <ellipse cx="100" cy="206" rx="38" ry="42" fill="#cbd5e1" />
      <path d="M78 186c8-6 14-6 22 0M80 202c8-6 14-6 20 0" fill="none" stroke="#94a3b8" strokeWidth="4" strokeLinecap="round" />
      <rect x="83" y="212" width="12" height="38" rx="6" fill="#e2e8f0" />
      <rect x="105" y="212" width="12" height="38" rx="6" fill="#e2e8f0" />
      <path d="M74 132 79 98l22 18Z" fill="#cbd5e1" />
      <path d="M126 132l-5-34-22 18Z" fill="#cbd5e1" />
      <path d="M80 122l2-14 9 8Z" fill="#f9a8b8" />
      <path d="M120 122l-2-14-9 8Z" fill="#f9a8b8" />
      <circle cx="100" cy="144" r="32" fill="#cbd5e1" />
      <path d="M92 116v10M100 114v12M108 116v10" stroke="#94a3b8" strokeWidth="4" strokeLinecap="round" />
      <g className="vx-blink-eyes" style={delay(1.4)}>
        <ellipse cx="88" cy="142" rx="4.5" ry="6" fill={INK} />
        <ellipse cx="112" cy="142" rx="4.5" ry="6" fill={INK} />
        <circle cx="89.5" cy="139.5" r="1.5" fill="#fff" />
        <circle cx="113.5" cy="139.5" r="1.5" fill="#fff" />
      </g>
      <path d="M95.5 153h9l-4.5 5Z" fill="#f472b6" />
      <path d="M100 158q-4 5-9 2M100 158q4 5 9 2" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <path d="M72 152h12M72 159l12-3M128 152h-12M128 159l-12-3" stroke="#64748b" strokeWidth="1.6" strokeLinecap="round" />

    </svg>
  );
}

export function DogArt({ className }: { className?: string }) {
  return (
    <svg viewBox="150 66 132 188" className={className} aria-hidden focusable="false">
      <g className="vx-wag">
        <path d="M244 214c30-6 34-28 28-50" fill="none" stroke="#e7d3b5" strokeWidth="13" strokeLinecap="round" />
      </g>
      <ellipse cx="210" cy="196" rx="52" ry="54" fill="#f3e7d3" />
      <ellipse cx="226" cy="184" rx="18" ry="22" fill="#e7d3b5" />
      <rect x="186" y="204" width="17" height="46" rx="8.5" fill="#f8efe1" />
      <rect x="215" y="204" width="17" height="46" rx="8.5" fill="#f8efe1" />
      <rect x="176" y="148" width="66" height="10" rx="5" fill="var(--primary)" />
      <circle cx="209" cy="164" r="7" fill="var(--accent)" />
      <path d="M206 164h6M209 161v6" stroke="var(--accent-foreground)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="209" cy="112" r="42" fill="#f3e7d3" />
      <path d="M170 90c-14 8-14 36-6 52 12-2 16-26 14-44Z" fill="#b9875a" />
      <path d="M248 90c14 8 14 36 6 52-12-2-16-26-14-44Z" fill="#b9875a" />
      <ellipse cx="224" cy="104" rx="14" ry="15" fill="#d9b48a" />
      <g className="vx-blink-eyes">
        <circle cx="194" cy="106" r="5" fill={INK} />
        <circle cx="224" cy="106" r="5" fill={INK} />
        <circle cx="196" cy="104" r="1.7" fill="#fff" />
        <circle cx="226" cy="104" r="1.7" fill="#fff" />
      </g>
      <ellipse cx="209" cy="130" rx="20" ry="15" fill="#fbf5ea" />
      <ellipse cx="209" cy="123" rx="7.5" ry="5.5" fill={INK} />
      <path d="M209 128v5M209 133q-6 6-12 2M209 133q6 6 12 2" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M204 137q5 11 10 0Z" fill="#f472b6" />
    </svg>
  );
}
