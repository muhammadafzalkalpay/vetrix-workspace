import type { Metadata } from "next";
import { Lock } from "lucide-react";
import type { Permission } from "@vetrix/domain";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { requireShell } from "@/lib/session";
import { findNavItem } from "./nav";

interface SectionProps {
  href: string;
  permission: Permission;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  /** Records already on file, when the list screen is not built yet. */
  onFile?: (shell: Awaited<ReturnType<typeof requireShell>>) => Promise<number>;
  noun?: [singular: string, plural: string];
}

export function sectionMetadata(href: string): Metadata {
  return { title: `${findNavItem(href)?.label ?? "Vetrix"} · Vetrix` };
}

/**
 * A staff section that checks its permission at the active location. Shows an
 * empty state until the section has data to list.
 */
export async function SectionPage({ href, permission, description, emptyTitle, emptyDescription, onFile, noun }: SectionProps) {
  const shell = await requireShell();
  const item = findNavItem(href)!;
  if (!shell.permissions.has(permission)) {
    return (
      <EmptyState
        icon={Lock}
        title="You do not have access to this page"
        description={`Your role at ${shell.location.name} does not include ${item.label.toLowerCase()}. Ask your practice manager if you need it.`}
      />
    );
  }
  const count = onFile ? await onFile(shell) : 0;
  const onFileTitle =
    count > 0 && noun ? `${count.toLocaleString("en-US")} ${count === 1 ? noun[0] : noun[1]} on file` : undefined;
  return (
    <>
      <PageHeader title={item.label} description={description} />
      <EmptyState
        icon={item.icon}
        title={onFileTitle ?? emptyTitle}
        description={onFileTitle ? `The searchable ${item.label.toLowerCase()} list is the next screen being built.` : emptyDescription}
      />
    </>
  );
}
