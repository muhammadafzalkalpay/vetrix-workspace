import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/vetrix/logo";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { getMessagingMode } from "@/lib/env";
import { requireStaff } from "@/lib/session";

export const dynamic = "force-dynamic";

// Signed-in staff area. Every page below this layout requires an active staff
// record in the chosen organization.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  const sandbox = getMessagingMode() === "sandbox";
  return (
    <div className="min-h-dvh">
      <header className="flex h-14 items-center gap-3 border-b bg-card px-4 sm:px-6">
        <Link href="/overview" aria-label="Vetrix overview" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo />
        </Link>
        <span className="hidden text-small text-muted-foreground sm:inline">{ctx.organization.organization_name}</span>
        {sandbox && (
          <Badge variant="secondary" className="ml-auto" title="Calls and texts are simulated and not sent">
            Sandbox
          </Badge>
        )}
        <SignOutButton size="sm" className={sandbox ? "" : "ml-auto"} />
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
