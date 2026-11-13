"use client";

// Two buttons on the sign-in page's brand panel: call Riley (a real phone
// call to the clinic's number) and chat with Riley (a Sandbox chat with the
// sample clinic, in a pop-up window).
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { MessageSquareText, PhoneCall, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SandboxConsole, type QuickCaller } from "@/features/front-desk/sandbox-console";
import { cn } from "@/lib/utils";
import { endPublicAction, sendPublicAction, startPublicAction } from "./actions";

export function TryRiley({
  aiName,
  callers,
  chatEnabled,
  phone,
  className,
}: {
  aiName: string;
  callers: QuickCaller[];
  chatEnabled: boolean;
  phone: { tel: string; display: string } | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const base = cn(buttonVariants({ size: "sm" }), "h-10 px-4");
  return (
    <div className={cn("flex flex-wrap gap-2.5", className)}>
      {phone ? (
        <a href={`tel:${phone.tel}`} className={cn(base, "bg-white text-primary-dark hover:bg-white/90")} title={`Call ${phone.display}`}>
          <PhoneCall aria-hidden /> Call {aiName}
        </a>
      ) : (
        <span className={cn(base, "cursor-not-allowed bg-white/60 text-primary-dark")} aria-disabled="true" title="The phone line is being set up">
          <PhoneCall aria-hidden /> Phone line coming soon
        </span>
      )}
      {chatEnabled && (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <button type="button" className={cn(base, "border border-white/30 bg-white/10 text-white hover:bg-white/20")}>
              <MessageSquareText aria-hidden /> Chat with {aiName}
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-900/50 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[92dvh] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl bg-background p-5 shadow-2xl sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="grid gap-1">
                  <Dialog.Title className="text-h3 font-semibold">Chat with {aiName}</Dialog.Title>
                  <Dialog.Description className="text-small text-muted-foreground">
                    A sample clinic in Sandbox mode: nothing is sent to a phone. Please don&apos;t enter real personal details.
                  </Dialog.Description>
                </div>
                <Dialog.Close className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
                  <X className="size-5" />
                </Dialog.Close>
              </div>
              <SandboxConsole aiName={aiName} callers={callers} actions={{ start: startPublicAction, send: sendPublicAction, end: endPublicAction }} showCallsLink={false} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </div>
  );
}
