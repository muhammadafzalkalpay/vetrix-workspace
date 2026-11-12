import type { Metadata } from "next";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Overview · Vetrix" };

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function OverviewPage() {
  const ctx = await requireStaff();
  const firstName = ctx.access.displayName.split(" ")[0];
  return (
    <header className="grid gap-1">
      <h1 className="text-h1">
        {greeting(new Date().getHours())}, {firstName}
      </h1>
      <p className="text-muted-foreground">
        {ctx.organization.organization_name} · {ctx.access.locations.size}{" "}
        {ctx.access.locations.size === 1 ? "location" : "locations"}
      </p>
    </header>
  );
}
