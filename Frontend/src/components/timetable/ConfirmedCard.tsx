import { COPY } from "@/lib/copy";
import { fmtDateTime } from "@/lib/format";
import type { Confirmation } from "@/lib/types";
import { Blueprint } from "../ui/Blueprint";
import { Button } from "../ui/Button";
import { CircleCheckIcon } from "../ui/Icons";

/** Shown after POST /confirm succeeds. Every value comes from the Confirmation response. */
export function ConfirmedCard({
  confirmation,
}: {
  confirmation: Confirmation;
}) {
  const cells: [string, string | number][] = [
    [COPY.confirmed.reference, confirmation.reference],
    [COPY.confirmed.courses, confirmation.courses],
    [COPY.confirmed.sections, confirmation.sections],
    [COPY.confirmed.credits, confirmation.credits],
  ];
  return (
    <Blueprint className="print-exclude mt-[18px] animate-rise-in bg-accent-100 px-[16px] py-[14px]">
      <div className="flex items-center gap-[10px]">
        <CircleCheckIcon size={26} className="shrink-0 text-accent-700" />
        <div>
          <h4 className="font-display text-[20px] font-semibold leading-none text-accent-900">
            {COPY.confirmed.title}
          </h4>
          <p className="mt-[3px] text-[11px] text-accent-800">
            {fmtDateTime(confirmation.confirmed_at)}
          </p>
        </div>
      </div>
      <dl className="mt-[12px] grid grid-cols-4 border-y border-accent-300">
        {cells.map(([k, v]) => (
          <div
            key={k}
            className="border-l border-accent-300 px-[10px] py-[7px] first:border-l-0 first:pl-0"
          >
            <dt className="eyebrow text-accent-800">{k}</dt>
            <dd className="font-display text-[16px] font-semibold text-accent-900">
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-[12px] flex gap-[8px]">
        {/*
          TODO(backend): open question in the brief (section 12) whether these must work for the demo.
          Suggested: GET /timetable.ics?reference=... for "Add to calendar" and GET /timetable.pdf for "Download".
          Until then they are display only, like the prototype.
        */}
        <Button variant="secondary" onClick={() => {}}>
          {COPY.confirmed.calendar}
        </Button>
        <Button variant="secondary" onClick={() => {}}>
          {COPY.confirmed.download}
        </Button>
      </div>
    </Blueprint>
  );
}
