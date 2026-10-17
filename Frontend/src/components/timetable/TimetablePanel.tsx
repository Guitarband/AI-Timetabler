"use client";
import { config } from "@/lib/config";
import { COPY } from "@/lib/copy";
import { friendFirstName } from "@/lib/rules";
import type {
  Confirmation,
  Context,
  Phase,
  Plan,
  Rule,
  Section,
} from "@/lib/types";
import { Blueprint } from "../ui/Blueprint";
import { Tag } from "../ui/Tag";
import { ConfirmBar } from "./ConfirmBar";
import { ConfirmedCard } from "./ConfirmedCard";
import { CourseList } from "./CourseList";
import { FriendStrip } from "./FriendStrip";
import { Legend } from "./Legend";
import { MatchBadge } from "./MatchBadge";
import { RuleScores } from "./RuleScores";
import { WeekGrid } from "./WeekGrid";

/**
 * Right panel (fills the rest of the width, scrolls on its own). Top to bottom:
 *   header (title, version tag, one-line description, match badge) / friend strip / week grid / legend /
 *   audit (rules scored · courses) / confirm bar OR confirmed card.
 */
export function TimetablePanel({
  phase,
  plan,
  prevMatch,
  rules,
  context,
  confirmation,
  busy,
  onAsk,
  onConfirm,
  onSectionSelect,
}: {
  phase: Phase;
  plan: Plan | null;
  prevMatch: number | null;
  rules: Rule[];
  context: Context | null;
  confirmation: Confirmation | null;
  busy: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onSectionSelect?: (section: Section) => void;
}) {
  const term = context?.term ?? "";
  const published = plan?.source_sections ?? context?.published_sections ?? 0;
  const confirmed = phase === "confirmed";
  const friendFirst = friendFirstName(rules);
  const friends = plan?.friends?.length
    ? plan.friends
    : plan?.friend
      ? [plan.friend]
      : [];
  const friendLegend = friends.length > 1 ? "selected friends" : friendFirst;

  const title = confirmed
    ? COPY.timetable.titleFinal(term)
    : plan
      ? COPY.timetable.titleDraft
      : COPY.timetable.titleEmpty;
  const versionTag = confirmed
    ? COPY.timetable.tagFinal
    : plan
      ? COPY.timetable.tagDraft(plan.version)
      : COPY.timetable.tagEmpty;

  const sections = plan?.sections ?? [];
  const keptClear = plan
    ? rules
        .filter((r) => r.kind === "dayoff")
        .map((r) => Number(r.value))
        .filter((d) => d >= 1 && d <= 5 && !sections.some((s) => s.day === d))
    : [];

  const showConfirmBar =
    plan &&
    (phase === "timetable" || phase === "adjust" || phase === "adjusting");

  return (
    <Blueprint
      as="section"
      id="timetable"
      tabIndex={-1}
      aria-label="Timetable"
      className="planner-timetable min-h-0 min-w-0 bg-bg"
    >
      <div className="scroll-thin h-full overflow-y-auto px-[16px] pb-[18px] pt-[15px]">
        <div className="flex flex-wrap items-start justify-between gap-[16px]">
          <div className="min-w-[190px] flex-1">
            <div className="flex flex-wrap items-center gap-[8px]">
              <h4 className="font-display text-[20px] font-semibold leading-tight">
                {title}
              </h4>
              <Tag tone="outline">{versionTag}</Tag>
              {confirmed && (
                <Tag tone="accent" className="uppercase">
                  {COPY.timetable.enrolled}
                </Tag>
              )}
            </div>
            {context && (
              <p className="mt-[3px] text-[12px] leading-[1.45] ink-55">
                {plan
                  ? COPY.timetable.desc(published, term)
                  : COPY.timetable.descEmpty(published, term)}
              </p>
            )}
          </div>
          {plan && config.showMatchBadge && (
            <MatchBadge value={plan.match_pct} previous={prevMatch} />
          )}
        </div>

        {friends.map((friend) => (
          <FriendStrip
            key={friend.name}
            friend={friend}
            sections={sections.filter((s) =>
              s.shared_with
                ? s.shared_with.includes(friend.name)
                : friends.length === 1 && s.with_friend,
            )}
          />
        ))}

        {plan && !confirmed && onSectionSelect && (
          <p className="mt-3 text-sm ink-62">
            Select a class to compare times, swap or keep it in place.
          </p>
        )}
        <section
          className="overflow-x-auto"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll this region horizontally.
          tabIndex={0}
          aria-label="Scroll the weekly timetable horizontally"
        >
          <WeekGrid
            sections={sections}
            keptClearDays={keptClear}
            friendFirst={friendFirst}
            placeholder={plan ? undefined : COPY.timetable.placeholder}
            onSectionSelect={confirmed ? undefined : onSectionSelect}
            disabled={busy || phase !== "adjust"}
            keptSections={plan?.kept_sections}
          />
        </section>
        <Legend friendFirst={friendLegend} />

        {plan && (
          <div className="timetable-audit mt-[18px] grid gap-[18px]">
            <RuleScores scores={plan.scores} />
            <CourseList sections={sections} />
          </div>
        )}

        {showConfirmBar && (
          <ConfirmBar
            summary={plan.summary}
            busy={busy || phase === "timetable"}
            onAsk={onAsk}
            onConfirm={onConfirm}
          />
        )}
        {confirmed && confirmation && (
          <ConfirmedCard confirmation={confirmation} />
        )}
      </div>
    </Blueprint>
  );
}
