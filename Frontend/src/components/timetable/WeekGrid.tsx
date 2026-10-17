import { COPY } from "@/lib/copy";
import { DAY_SHORT, fmtHourLabel, gridRange, SLOT_MIN } from "@/lib/time";
import type { Section } from "@/lib/types";
import { SectionBlock } from "./SectionBlock";

/**
 * Mon-Fri week grid, CSS grid:
 *   columns: 54px repeat(5, 1fr)    (time column + Mon..Fri)
 *   rows:    26px repeat(N, 26px)   (day header + one row per 30 min; 09:00-18:00 = 18 rows)
 * Grows to fit sections outside 09:00-18:00 instead of cutting them.
 * Works with any Section[]; nothing here is tied to the prototype data.
 */
export function WeekGrid({
  sections,
  keptClearDays,
  friendFirst,
  placeholder,
  onSectionSelect,
  keptSections = [],
  disabled = false,
}: {
  sections: Section[];
  keptClearDays: number[];
  friendFirst: string | null;
  placeholder?: string;
  onSectionSelect?: (section: Section) => void;
  keptSections?: string[];
  disabled?: boolean;
}) {
  const { startMin, endMin } = gridRange(sections);
  const rows = (endMin - startMin) / SLOT_MIN;
  const hours: number[] = [];
  for (let m = startMin; m < endMin; m += 60) hours.push(m);

  return (
    <section
      className="relative mt-[14px] grid min-w-[800px]"
      style={{
        gridTemplateColumns: "54px repeat(5, 1fr)",
        gridTemplateRows: `26px repeat(${rows}, 26px)`,
      }}
      aria-label="Weekly timetable"
    >
      {DAY_SHORT.map((d, i) => (
        <div
          key={d}
          className="eyebrow self-center pl-[4px] ink-70"
          style={{ gridRow: 1, gridColumn: i + 2 }}
        >
          {d}
        </div>
      ))}

      {/* Lines: horizontal every 52px (each hour), vertical every 20%, 60% opacity. */}
      <div
        aria-hidden
        className="pointer-events-none border-b border-r border-divider opacity-60"
        style={{
          gridRow: `2 / span ${rows}`,
          gridColumn: "2 / span 5",
          backgroundImage:
            "linear-gradient(to bottom, var(--color-divider) 1px, transparent 1px), linear-gradient(to right, var(--color-divider) 1px, transparent 1px)",
          backgroundSize: "100% 52px, 20% 100%",
        }}
      />

      {hours.map((m) => (
        <div
          key={m}
          className="-translate-y-[6px] pr-[8px] text-right text-[11px] leading-none ink-50"
          style={{ gridRow: (m - startMin) / SLOT_MIN + 2, gridColumn: 1 }}
        >
          {fmtHourLabel(m)}
        </div>
      ))}

      {/* A day kept clear by a `dayoff` rule: stripes + "KEPT CLEAR" at the foot of the column. */}
      {keptClearDays.map((d) => (
        <div
          key={`clear-${d}`}
          className="kept-clear relative flex animate-block-in items-end justify-center pb-[6px]"
          style={{ gridRow: `2 / span ${rows}`, gridColumn: d + 1 }}
        >
          <span className="eyebrow bg-bg px-[4px] text-[10px] text-accent-800">
            <span className="sr-only">{DAY_SHORT[d - 1]} </span>
            {COPY.timetable.keptClear}
          </span>
        </div>
      ))}

      {sections.map((s, i) => (
        <SectionBlock
          key={s.key}
          section={s}
          gridStartMin={startMin}
          friendFirst={friendFirst}
          index={i}
          onSelect={onSectionSelect}
          kept={keptSections.includes(s.key)}
          disabled={disabled}
        />
      ))}

      {placeholder && (
        <div
          className="pointer-events-none z-10 flex items-center justify-center"
          style={{ gridRow: `2 / span ${rows}`, gridColumn: "2 / span 5" }}
        >
          <span className="border border-divider bg-bg px-[16px] py-[10px] font-display text-[14px] font-semibold uppercase tracking-[0.06em] ink-55">
            {placeholder}
          </span>
        </div>
      )}
    </section>
  );
}
