"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shown inside the app shell when a page fails to load. Nothing was changed. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto grid max-w-md justify-items-center gap-4 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-destructive">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <h2 className="text-h2">This page could not load</h2>
      <p className="text-muted-foreground">
        Something went wrong on our side. Nothing you were working on was changed. Try again, and if it keeps happening, tell your practice manager.
      </p>
      {error.digest && <p className="text-caption text-muted-foreground">Reference: {error.digest}</p>}
      <Button onClick={reset}>
        <RotateCcw aria-hidden /> Try again
      </Button>
    </div>
  );
}
