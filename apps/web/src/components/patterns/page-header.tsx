import { BrandBackdrop } from "@/components/vetrix/brand-backdrop";
import { cn } from "@/lib/utils";

/** Title banner at the top of every staff page, on the Vetrix navy surface. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative mb-6 flex flex-col gap-4 overflow-hidden rounded-xl px-6 pb-7 pt-5 text-white shadow-card sm:flex-row sm:items-end sm:justify-between sm:px-8",
        className,
      )}
    >
      <BrandBackdrop waves="55%" glow={false} />
      <div className="relative grid gap-1">
        <h2 className="text-h1">{title}</h2>
        {description && <p className="text-white/75">{description}</p>}
      </div>
      {actions && <div className="relative flex gap-2">{actions}</div>}
    </div>
  );
}
