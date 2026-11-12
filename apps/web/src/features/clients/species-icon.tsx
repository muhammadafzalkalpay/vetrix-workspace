import { Bird, Cat, Dog, PawPrint, Rabbit, Turtle, type LucideIcon } from "lucide-react";
import type { Species } from "@vetrix/domain";
import { cn } from "@/lib/utils";

const ICON: Record<Species, LucideIcon> = { dog: Dog, cat: Cat, rabbit: Rabbit, bird: Bird, reptile: Turtle, other: PawPrint };

export function SpeciesIcon({ species, className }: { species: Species; className?: string }) {
  const Icon = ICON[species] ?? PawPrint;
  return <Icon className={cn("size-4", className)} aria-hidden />;
}

/** Round avatar with the pet's species icon, dimmed when the pet is no longer active. */
export function PetAvatar({ species, inactive, className }: { species: Species; inactive?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full",
        inactive ? "bg-muted text-muted-foreground" : "bg-secondary text-primary",
        className,
      )}
    >
      <SpeciesIcon species={species} className="size-5" />
    </span>
  );
}
