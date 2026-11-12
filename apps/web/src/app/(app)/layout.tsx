import { AppShell } from "@/features/shell/app-shell";
import { getMessagingMode } from "@/lib/env";
import { getSession, requireShell } from "@/lib/session";

export const dynamic = "force-dynamic";

// Signed-in staff area. Every page below this layout requires an active staff
// record in the chosen organization and a location they can open.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const shell = await requireShell();
  const session = await getSession();
  return (
    <AppShell
      user={{ name: shell.access.displayName, email: session?.user.email ?? "" }}
      organization={{ id: shell.organization.organization_id, name: shell.organization.organization_name }}
      organizationCount={shell.memberships.length}
      location={{ id: shell.location.id, name: shell.location.name }}
      locations={shell.locations.map((l) => ({ id: l.id, name: l.name }))}
      permissions={[...shell.permissions]}
      sandbox={getMessagingMode() === "sandbox"}
    >
      {children}
    </AppShell>
  );
}
