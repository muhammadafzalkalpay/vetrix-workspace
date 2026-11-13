import type { MessageStatus } from "@vetrix/db/runtime";
import { Badge } from "@/components/ui/badge";
import { SandboxBadge } from "@/features/front-desk/labels";

/** Simulated messages show the Sandbox label; the rest their delivery state. */
export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  if (status === "simulated") return <SandboxBadge />;
  if (status === "sent" || status === "delivered") return <Badge variant="success">{status === "sent" ? "Sent" : "Delivered"}</Badge>;
  if (status === "failed") return <Badge variant="danger">Not sent</Badge>;
  if (status === "suppressed") return <Badge variant="muted">Not sent (opted out)</Badge>;
  if (status === "held") return <Badge variant="warning">Held</Badge>;
  return <Badge variant="muted">Sending</Badge>;
}
