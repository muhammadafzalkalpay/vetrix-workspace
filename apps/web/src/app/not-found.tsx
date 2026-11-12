import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { LogoGlyph } from "@/components/vetrix/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <LogoGlyph className="size-10" />
      <div className="grid gap-2">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
          <Compass className="size-6" aria-hidden />
        </span>
        <h1 className="text-h1">We could not find that page</h1>
        <p className="max-w-md text-muted-foreground">
          It may have moved, or the record is not at this location. Check the address, or go back to the overview.
        </p>
      </div>
      <Link href="/overview" className={buttonVariants()}>
        Go to overview
      </Link>
    </main>
  );
}
