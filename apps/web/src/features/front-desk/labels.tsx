// Small shared bits for calls and tasks: triage badges, channel icons and times.
import { MessageSquareText, PhoneCall } from "lucide-react";
import type { TriageLevel } from "@vetrix/domain";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function TriageBadge({ level, className }: { level: TriageLevel; className?: string }) {
  if (level === "emergency") return <Badge variant="danger" className={className}>Emergency</Badge>;
  if (level === "urgent") return <Badge variant="warning" className={className}>Urgent</Badge>;
  return <Badge variant="muted" className={className}>Routine</Badge>;
}

export function SandboxBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-dashed border-primary/50 text-primary", className)} title="Simulated: nothing was sent to a real phone">
      Sandbox
    </Badge>
  );
}

export function ChannelIcon({ channel, className }: { channel: "voice" | "sms"; className?: string }) {
  const Icon = channel === "voice" ? PhoneCall : MessageSquareText;
  return <Icon className={cn("size-4", className)} aria-label={channel === "voice" ? "Phone call" : "Text conversation"} />;
}

/** "Today 9:41 AM", "Yesterday 4:02 PM" or "Nov 12, 9:41 AM", in clinic time. */
export function formatWhen(instant: Date, timezone: string, now = new Date()): string {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(instant);
  if (day(instant) === day(now)) return `Today ${time}`;
  if (day(instant) === day(new Date(now.getTime() - 86_400_000))) return `Yesterday ${time}`;
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: timezone }).format(instant)}, ${time}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Plain words for task types created by the front desk. */
export const TASK_TYPE_LABEL: Record<string, string> = {
  emergency_alert: "Emergency alert",
  urgent_callback: "Urgent callback",
  callback: "Callback",
  records_request: "Records request",
  refill_request: "Refill request",
  service_request: "Service request",
  change_appointment: "Change appointment",
};

/** Plain words for what the front desk did about a triage trigger. */
export const TRIAGE_ACTION_LABEL: Record<string, string> = {
  transferred: "Transferred to staff",
  transfer_failed: "Transfer failed",
  er_referral: "Referred to ER",
  staff_call_now: "Staff asked to call now",
  book_urgent: "Booked same or next day",
  noted: "Noted",
};
