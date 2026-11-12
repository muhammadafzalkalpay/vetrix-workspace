import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Our type scale (text-h1 … text-caption) are font sizes, not colours, so
// tailwind-merge must not drop them when a text colour is also present.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["display", "h1", "h2", "h3", "body", "small", "caption"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
