import { COPY } from "@/lib/copy";
import type { PlanSummary } from "@/lib/types";
import { Blueprint } from "../ui/Blueprint";
import { Button } from "../ui/Button";

/** Summary + "Ask for a change" (focuses the composer) + "Confirm enrolment". */
export function ConfirmBar({
  summary,
  busy,
  onAsk,
  onConfirm,
}: {
  summary: PlanSummary;
  busy: boolean;
  onAsk: () => void;
  onConfirm: () => void;
}) {
  return (
    <Blueprint className="mt-[18px] flex flex-wrap animate-rise-in items-center justify-between gap-[14px] bg-bg px-[14px] py-[11px]">
      <p className="text-[12px] ink-62">
        {COPY.confirmBar.summary(
          summary.sections,
          summary.credits,
          summary.hold_minutes,
        )}
      </p>
      <div className="flex flex-wrap gap-[8px]">
        <Button variant="secondary" disabled={busy} onClick={onAsk}>
          {COPY.confirmBar.ask}
        </Button>
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          {COPY.confirmBar.confirm}
        </Button>
      </div>
    </Blueprint>
  );
}
