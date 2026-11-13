import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { formatPhone } from "@vetrix/domain";
import { aiPersonaName, searchClients } from "@vetrix/db/runtime";
import { PageHeader } from "@/components/patterns/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { requirePage } from "@/features/clients/access";
import { aiMode } from "@/lib/ai";
import { SandboxConsole, type QuickCaller } from "@/features/front-desk/sandbox-console";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sandbox console · Vetrix" };

export default async function SandboxPage() {
  const shell = await requirePage("calls.view");
  if (!shell.permissions.has("schedule.manage")) {
    return (
      <>
        <PageHeader title="Sandbox console" />
        <Alert variant="warning">You need permission to book appointments to use the sandbox console.</Alert>
      </>
    );
  }
  const [aiName, clients] = await Promise.all([
    aiPersonaName(shell.clinic, shell.location.id),
    searchClients(shell.clinic, shell.location.id, { limit: 6 }),
  ]);
  const callers: QuickCaller[] = clients.rows.map((c) => ({
    name: `${c.first_name} ${c.last_name}`,
    mobile: c.mobile,
    display: formatPhone(c.mobile),
    pets: c.pets.filter((p) => p.status === "active").map((p) => p.name),
  }));

  return (
    <>
      <PageHeader
        title={`Talk to ${aiName}`}
        description={`Try the AI front desk as a client would. Bookings and tasks are real records here; nothing reaches a phone. Answering with ${aiMode() === "openai" ? "OpenAI" : "the sandbox AI (scripted)"}.`}
        actions={
          <Link href="/calls" className={cn(buttonVariants({ variant: "outline" }), "border-white/30 bg-white/10 text-white hover:bg-white/20")}>
            <ChevronLeft aria-hidden /> Calls
          </Link>
        }
      />
      <SandboxConsole aiName={aiName} callers={callers} />
    </>
  );
}
