"use client";
import { config } from "@/lib/config";
import { COPY } from "@/lib/copy";
import type { PartialAllocation } from "@/lib/partial-allocation";
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
  partialPreview,
  prevMatch,
  rules,
  context,
  confirmation,
  busy,
  onAsk,
  onConfirm,
  onReopen,
  onSectionSelect,
}: {
  phase: Phase;
  plan: Plan | null;
  partialPreview?: PartialAllocation | null;
  prevMatch: number | null;
  rules: Rule[];
  context: Context | null;
  confirmation: Confirmation | null;
  busy: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onReopen?: () => void;
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
      : partialPreview
        ? COPY.timetable.titlePartial
        : COPY.timetable.titleEmpty;
  const versionTag = confirmed
    ? COPY.timetable.tagFinal
    : plan
      ? COPY.timetable.tagDraft(plan.version)
      : partialPreview
        ? COPY.timetable.tagPartial
        : COPY.timetable.tagEmpty;

  const sections = plan?.sections ?? partialPreview?.sections ?? [];
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
      <div className="timetable-print-content scroll-thin h-full overflow-y-auto px-[16px] pb-[18px] pt-[15px]">
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
                  : partialPreview
                    ? COPY.timetable.descPartial(
                        partialPreview.sections.length,
                        partialPreview.totalClasses,
                      )
                    : COPY.timetable.descEmpty(published, term)}
              </p>
            )}
          </div>
          {plan && (
            <button
              type="button"
              className="secondary-button print-timetable"
              onClick={() => window.print()}
            >
              Print timetable
            </button>
          )}
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
          <p className="timetable-edit-hint mt-3 text-sm ink-62">
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
            friendFirst={plan ? friendFirst : null}
            placeholder={
              sections.length ? undefined : COPY.timetable.placeholder
            }
            onSectionSelect={confirmed ? undefined : onSectionSelect}
            disabled={busy || phase !== "adjust"}
            keptSections={plan?.kept_sections}
          />
        </section>
        <Legend friendFirst={plan ? friendLegend : null} />

        {partialPreview && !plan && (
          <section
            aria-label="Unallocated classes"
            className="mt-[18px] border-t border-divider pt-[12px]"
          >
            <p className="text-sm ink-70">
              This is a preview only. No seats are held, and it cannot be
              confirmed until every required class fits.{" "}
              {partialPreview.sections.length
                ? "Friends can match against the allocated classes."
                : "Allocate at least one class before friends can match with it."}
            </p>
            {partialPreview.limited && (
              <p className="mt-2 text-sm ink-70">
                The preview search reached its limit; a different partial
                arrangement may fit more classes.
              </p>
            )}
            <h5 className="mt-3 text-sm font-semibold">Not allocated</h5>
            {partialPreview.missing.length ? (
              <ul className="mt-1 list-inside list-disc text-sm ink-70">
                {partialPreview.missing.map((item) => (
                  <li key={item.classId}>
                    {item.code} {item.kind}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm ink-70">
                The server could not validate a full timetable. Try building
                again.
              </p>
            )}
            {!!sections.length && (
              <div className="mt-3">
                <CourseList sections={sections} />
              </div>
            )}
          </section>
        )}

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
          <>
            <ConfirmedCard confirmation={confirmation} />
            <button
              type="button"
              className="secondary-button mt-3"
              disabled={busy || !onReopen}
              onClick={onReopen}
            >
              Edit confirmed timetable
            </button>
            <p className="mt-2 text-sm">
              Creates an editable copy. Existing bookings stay in place until
              you confirm the revision.
            </p>
          </>
        )}
      </div>
    </Blueprint>
  );
}
