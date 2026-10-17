import { COPY } from "@/lib/copy";
import { DAY_SHORT } from "@/lib/time";
import type { FriendMatch, Section } from "@/lib/types";
import { PeopleIcon } from "../ui/Icons";

/** Only rendered when a timetable exists AND the user has a `friend` rule. */
export function FriendStrip({
  friend,
  sections = [],
}: {
  friend: FriendMatch;
  sections?: Section[];
}) {
  return (
    <div className="mt-[12px] animate-rise-in border border-accent-400 bg-accent-100 px-[12px] py-[9px]">
      <div className="flex flex-wrap items-start gap-[10px]">
        <PeopleIcon size={16} className="shrink-0 text-accent-700" />
        <p className="min-w-0 flex-1 break-words text-[13px] leading-[1.45] text-accent-900">
          {friend.text}
        </p>
        {friend.total > 0 && (
          <span className="shrink-0 text-[11px] text-accent-800">
            {COPY.friendStrip.tag(friend.shared, friend.total)}
          </span>
        )}
      </div>
      {sections.length > 0 && (
        <ul
          aria-label={`Classes shared with ${friend.name}`}
          className="mt-[7px] flex flex-col gap-[3px] text-[12px] leading-[1.4] text-accent-900"
        >
          {sections.map((section) => (
            <li key={section.key}>
              {section.code} · {section.kind} {section.section} ·{" "}
              {DAY_SHORT[section.day - 1]} {section.start}–{section.end}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
