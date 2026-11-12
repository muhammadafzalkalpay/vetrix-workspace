// Sign-in hero: a phone showing a Vetrix online booking that plays itself
// (pick the pet, the day, the time, confirm, booked) with a dog and a cat
// sitting beside it. Decorative; with reduced motion it shows the final state.
import type { CSSProperties } from "react";
import { CalendarCheck, Cat, Check, Dog, Syringe } from "lucide-react";
import { CatArt, DogArt } from "@/components/vetrix/pet-art";
import { LogoGlyph } from "@/components/vetrix/logo";
import { cn } from "@/lib/utils";

const delay = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

const DAYS = [
  { day: "Mon", date: 17 },
  { day: "Tue", date: 18 },
  { day: "Wed", date: 19, pick: 1.3 },
  { day: "Thu", date: 20 },
  { day: "Fri", date: 21 },
];
const SLOTS = [
  { time: "9:00" },
  { time: "10:30" },
  { time: "11:15" },
  { time: "2:15", pick: 2.0 },
  { time: "3:40" },
  { time: "4:30" },
];

const OPTION = "rounded-lg text-center font-medium";

function PhoneScreen() {
  return (
    <div className="relative grid h-full content-start gap-3 bg-card px-3.5 pb-4 pt-7 text-[11px] text-foreground">
      <div className="flex items-center gap-2">
        <LogoGlyph className="size-6" />
        <div className="grid leading-tight">
          <span className="font-semibold">Book a visit</span>
          <span className="text-[10px] text-muted-foreground">Main Veterinary Clinic</span>
        </div>
      </div>

      <div className="grid gap-1.5">
        <span className="text-[10px] font-medium text-muted-foreground">Who is it for?</span>
        <div className="flex gap-1.5">
          <span className="vx-select flex items-center gap-1 rounded-full px-2.5 py-1 font-medium" style={delay(0.7)}>
            <Dog className="size-3.5" /> Luna
          </span>
          <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">
            <Cat className="size-3.5" /> Milo
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border px-2.5 py-2">
        <Syringe className="size-3.5 text-primary" />
        <span className="font-medium">Vaccines</span>
        <span className="ml-auto text-[10px] text-muted-foreground">20 min</span>
      </div>

      <div className="grid grid-cols-5 gap-1">
        {DAYS.map(({ day, date, pick }) => (
          <span
            key={date}
            className={cn(OPTION, "grid py-1.5 leading-tight", pick ? "vx-select" : "bg-muted")}
            style={pick ? delay(pick) : undefined}
          >
            <span className="text-[9px] opacity-75">{day}</span>
            <span className="text-[12px] font-semibold">{date}</span>
          </span>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {SLOTS.map(({ time, pick }) => (
          <span
            key={time}
            className={cn(OPTION, "py-1.5", pick ? "vx-select" : "border")}
            style={pick ? delay(pick) : undefined}
          >
            {time}
          </span>
        ))}
      </div>

      <span className="vx-press mt-1 rounded-lg bg-primary py-2 text-center font-semibold text-primary-foreground" style={delay(2.6)}>
        Confirm booking
      </span>

      {/* Booked confirmation slides up over the screen */}
      <div
        className="vx-slide-up absolute inset-x-2.5 bottom-3 flex items-center gap-2 rounded-xl bg-navy-900 p-2.5 text-white shadow-lg"
        style={delay(3.1)}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success">
          <Check className="size-4" strokeWidth={3} />
        </span>
        <span className="grid leading-tight">
          <span className="font-semibold">Luna is booked</span>
          <span className="text-[10px] text-white/70">Wed 19, 2:15 PM · Dr. Marsh</span>
        </span>
      </div>
    </div>
  );
}

export function BookingScene({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("relative h-[420px] w-[460px] select-none", className)}>
      {/* Floor */}
      <div className="absolute inset-x-6 bottom-1 h-6 rounded-[50%] bg-black/25 blur-md" />

      {/* Phone */}
      <div className="vx-fade-up absolute left-1/2 top-0 -translate-x-1/2" style={delay(0.2)}>
        <div className="vx-float" style={delay(1)}>
          <div className="h-[400px] w-[220px] rounded-[34px] bg-navy-900 p-2 shadow-[0_30px_70px_-20px_rgba(0,0,0,0.7)] ring-1 ring-white/15">
            <div className="relative h-full overflow-hidden rounded-[27px]">
              <span className="absolute left-1/2 top-2 z-10 h-4 w-16 -translate-x-1/2 rounded-full bg-navy-900" />
              <PhoneScreen />
            </div>
          </div>
        </div>
      </div>

      {/* Calendar badge peeking from the phone */}
      <span
        className="vx-pop absolute right-[86px] top-12 flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-xl"
        style={delay(3.4)}
      >
        <CalendarCheck className="size-6" />
      </span>

      {/* Pets beside the phone */}
      <div className="vx-fade-up absolute bottom-0 left-0 w-[150px]" style={delay(0.5)}>
        <DogArt className="h-auto w-full" />
      </div>
      <div className="vx-fade-up absolute bottom-0 right-2 w-[108px]" style={delay(0.7)}>
        <CatArt className="h-auto w-full" />
      </div>
    </div>
  );
}
