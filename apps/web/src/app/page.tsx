import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4">
      <Badge variant="secondary" className="w-fit">Demo mode</Badge>
      <h1 className="text-3xl font-semibold tracking-tight">Vetrix</h1>
      <p className="text-muted-foreground">
        Every call answered. Every pet brought back. The project is set up, and features start at Milestone 1.
      </p>
    </main>
  );
}
