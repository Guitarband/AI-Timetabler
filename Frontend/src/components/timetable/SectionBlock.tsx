import { COPY } from "@/lib/copy";
import { gridPlacement } from "@/lib/time";
import type { Section } from "@/lib/types";

/**
 * One section on the week grid. 3 looks:
 *   normal  -> neutral-100 bg, divider border, accent-300 left bar
 *   friend  -> accent-100 bg, accent-400 border, accent-600 left bar, footer "◦ WITH <FRIEND>"
 *   changed -> accent-200 bg, accent-700 border, accent-700 left bar, footer "JUST CHANGED" (white on accent-700)
 * "Changed" wins over "friend". The kind/room line only shows for blocks of 90 min or more.
 */
export function SectionBlock({
  section,
  gridStartMin,
  friendFirst,
  index,
  onSelect,
  kept = false,
  disabled = false,
}: {
  section: Section;
  gridStartMin: number;
  friendFirst: string | null;
  index: number;
  onSelect?: (section: Section) => void;
  kept?: boolean;
  disabled?: boolean;
}) {
  const { gridRow, gridColumn, durationMin } = gridPlacement(
    section,
    gridStartMin,
  );
  const sharedWith =
    section.shared_with ??
    (section.with_friend && friendFirst ? [friendFirst] : []);
  const friendNames = sharedWith.join(", ");
  const compactNames =
    sharedWith.length > 1
      ? `${sharedWith[0]} +${sharedWith.length - 1}`
      : friendNames;
  const look = section.changed
    ? "changed"
    : sharedWith.length > 0
      ? "friend"
      : "normal";

  const styles = {
    normal: "bg-neutral-100 border-divider border-l-accent-300",
    friend: "bg-accent-100 border-accent-400 border-l-accent-600",
    changed: "bg-accent-200 border-accent-700 border-l-accent-700",
  }[look];

  const Element = onSelect ? "button" : "div";
  return (
    <Element
      type={onSelect ? "button" : undefined}
      disabled={onSelect ? disabled : undefined}
      onClick={onSelect ? () => onSelect(section) : undefined}
      aria-label={
        onSelect
          ? `${section.code} ${section.kind} ${section.section}, ${kept ? "kept, " : ""}view alternatives`
          : undefined
      }
      className={`relative z-10 mx-[2px] my-[1px] flex animate-block-in flex-col overflow-hidden border border-l-[3px] px-[5px] py-[3px] text-left ${onSelect ? "cursor-pointer hover:brightness-95 focus-visible:outline-2 focus-visible:outline-accent-700 disabled:cursor-wait" : ""} ${styles}`}
      style={{ gridRow, gridColumn, animationDelay: `${index * 40}ms` }}
      title={`${section.code} ${section.title} · ${section.kind} ${section.section} · ${section.start}–${section.end} · ${section.room}${friendNames ? ` · With ${friendNames}` : ""}`}
    >
      <span className="font-display text-[13px] font-semibold leading-[1.15]">
        {section.code}
        {kept && <span className="ml-1 text-[10px] font-medium">· Kept</span>}
      </span>
      <span className="text-[10px] leading-[1.35] ink-62">
        {section.start}–{section.end}
      </span>
      {friendNames && (
        <span
          title={friendNames}
          className="shrink-0 pt-[2px] text-[10px] font-medium leading-[1.2] text-accent-700"
        >
          <span aria-hidden="true">{COPY.block.withFriend(compactNames)}</span>
          <span className="sr-only">Shared with {friendNames}</span>
        </span>
      )}
      {durationMin >= 90 && (
        <span className="min-h-0 overflow-hidden text-[10px] leading-[1.35] ink-62">
          {section.kind} {section.section} · {section.room}
        </span>
      )}
      {look === "changed" && (
        <span className="mt-auto self-start bg-accent-700 px-[4px] py-[1px] text-[9.5px] font-medium uppercase tracking-[0.08em] text-white">
          {COPY.block.justChanged}
        </span>
      )}
    </Element>
  );
}
