import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** "Showing 1–25 of 50" with previous and next links that keep the other filters. */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));
    if (p > 1) q.set("page", String(p));
    else q.delete("page");
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const link = (p: number, disabled: boolean, children: React.ReactNode, label: string) =>
    disabled ? (
      <span aria-disabled className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-40")}>
        {children}
      </span>
    ) : (
      <Link href={href(p)} aria-label={label} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {children}
      </Link>
    );
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3 pt-2 text-small text-muted-foreground">
      <span>
        Showing {from.toLocaleString("en-US")}–{to.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
      </span>
      <span className="flex gap-2">
        {link(page - 1, page <= 1, <ChevronLeft aria-hidden />, "Previous page")}
        {link(page + 1, page >= pages, <ChevronRight aria-hidden />, "Next page")}
      </span>
    </nav>
  );
}
