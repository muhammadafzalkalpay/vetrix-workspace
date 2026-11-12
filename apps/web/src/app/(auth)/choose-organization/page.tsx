import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2, ChevronRight } from "lucide-react";
import { chooseOrganization } from "@/features/auth/actions";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { getStaffContext } from "@/lib/session";

export const metadata: Metadata = { title: "Choose a clinic · Vetrix" };

export default async function ChooseOrganizationPage() {
  const result = await getStaffContext();
  if (!result) redirect("/sign-in");
  if (result.status === "no_access") redirect("/no-access");
  const memberships = result.status === "ok" ? result.context.memberships : result.memberships;
  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-h1">Choose a clinic</h1>
        <p className="text-muted-foreground">You work with more than one. You can switch later from the menu.</p>
      </header>
      <ul className="grid gap-2">
        {memberships.map((m) => (
          <li key={m.organization_id}>
            <form action={chooseOrganization}>
              <input type="hidden" name="organizationId" value={m.organization_id} />
              <button
                type="submit"
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg border bg-card p-4 text-left shadow-card transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Building2 className="size-5 text-primary" aria-hidden />
                <span className="flex-1 font-medium">{m.organization_name}</span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </button>
            </form>
          </li>
        ))}
      </ul>
      <SignOutButton variant="ghost" className="justify-self-start" />
    </>
  );
}
