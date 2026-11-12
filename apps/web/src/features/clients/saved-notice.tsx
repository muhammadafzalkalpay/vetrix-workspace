import { CheckCircle2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";

/** Shown after a save redirect (?saved=1). */
export function SavedNotice({ show, children = "Saved." }: { show: boolean; children?: React.ReactNode }) {
  if (!show) return null;
  return (
    <Alert variant="success" className="mb-5">
      <CheckCircle2 aria-hidden />
      <p>{children}</p>
    </Alert>
  );
}
