"use client";
import { useEffect, useRef, useState } from "react";
import { PACING } from "@/lib/config";
import { COPY } from "@/lib/copy";
import { Blueprint } from "../ui/Blueprint";

/**
 * Preference match %. Counts from the old value to the new one in 700ms (ease-out cubic).
 * Delta "▲ +2" / "▼ -20" only shows when the value actually changed.
 */
export function MatchBadge({
  value,
  previous,
}: {
  value: number;
  previous: number | null;
}) {
  const [display, setDisplay] = useState(previous ?? 0);
  const from = useRef(previous ?? 0);

  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / PACING.countUp);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(Math.round(a + (value - a) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const delta = previous === null ? 0 : value - previous;

  return (
    <Blueprint className="shrink-0 bg-accent-100 px-[14px] pb-[7px] pt-[6px] text-center">
      <div className="flex items-start justify-center gap-[6px]">
        <span className="font-display text-[36px] font-normal leading-none text-accent-900 tabular-nums">
          {display}%
        </span>
        {delta !== 0 && (
          <span className="mt-[12px] font-display text-[12px] font-semibold text-accent-700">
            {delta > 0 ? `▲ +${delta}` : `▼ ${delta}`}
          </span>
        )}
      </div>
      <div className="eyebrow mt-[4px] text-accent-800">
        {COPY.timetable.matchLabel}
      </div>
    </Blueprint>
  );
}
