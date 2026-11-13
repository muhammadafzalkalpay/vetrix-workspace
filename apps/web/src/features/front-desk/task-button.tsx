"use client";

import { useActionState } from "react";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { taskStatusAction } from "./actions";

/** Marks a task done, or reopens a done one. */
export function TaskButton({ taskId, done }: { taskId: string; done: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(() => taskStatusAction(taskId, done ? "open" : "done"), null);
  return (
    <form action={action} className="grid justify-items-end gap-1">
      <Button type="submit" size="sm" variant={done ? "outline" : "default"} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : done ? <RotateCcw aria-hidden /> : <Check aria-hidden />}
        {done ? "Reopen" : "Mark done"}
      </Button>
      {state && !state.ok && (
        <p className="text-caption text-destructive" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
