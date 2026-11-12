import { Badge } from "@/components/ui/badge";
import { getMessagingMode } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function Home() {
  const sandbox = getMessagingMode() === "sandbox";
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4">
      {sandbox && (
        <Badge variant="secondary" className="w-fit">
          Sandbox · calls and texts are simulated
        </Badge>
      )}
      <h1 className="text-3xl font-semibold tracking-tight">Vetrix</h1>
      <p className="text-muted-foreground">Every call answered. Every pet brought back.</p>
    </main>
  );
}
