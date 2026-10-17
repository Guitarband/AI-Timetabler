"use client";
import { useReveal } from "@/hooks/useReveal";
import type { RuleChangeProposal } from "@/lib/enrolment-contract";
import type { Message as AssistantMessage } from "@/lib/types";
import { ThoughtLog } from "./ThoughtLog";

/** AI message: 26x26 "AI" avatar, then thought log, main text (14px) and an optional note (accent-100, 12px). */
export function AiMessage({
  message,
  animate,
  error,
  onAction,
  actionDisabled,
  onRuleChange,
  currentPlanId,
}: {
  message: AssistantMessage;
  animate: boolean;
  error?: boolean;
  onAction?: (action: NonNullable<AssistantMessage["action"]>) => void;
  actionDisabled?: boolean;
  onRuleChange?: (proposal: RuleChangeProposal, accept: boolean) => void;
  currentPlanId?: string;
}) {
  const { shown, checked, textVisible } = useReveal(
    message.steps.length,
    animate,
  );
  return (
    <div className="flex animate-rise-in gap-[10px]">
      <span
        aria-hidden
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center border border-accent font-display text-[10px] font-semibold text-accent-700"
      >
        AI
      </span>
      <div className="min-w-0 flex-1 pt-[3px]">
        <ThoughtLog steps={message.steps} shown={shown} checked={checked} />
        {textVisible && (
          <div className="animate-rise-in">
            {/* Text from the API is rendered as plain text (React escapes it). Never use dangerouslySetInnerHTML here. */}
            <p
              className={`whitespace-pre-line text-[14px] leading-[1.5] ${error ? "text-accent-900" : ""}`}
            >
              {message.text}
            </p>
            {message.note && (
              <p className="mt-[8px] bg-accent-100 px-[10px] py-[7px] text-[12px] leading-[1.5] text-accent-900">
                {message.note}
              </p>
            )}
            {message.action && onAction && (
              <div className="course-chat-action">
                <button
                  type="button"
                  disabled={actionDisabled}
                  onClick={() => message.action && onAction(message.action)}
                >
                  {message.action === "course_onboarding"
                    ? "Choose courses"
                    : "Start a new timetable"}
                </button>
              </div>
            )}
            {message.rule_change && (
              <RuleChangeReview
                proposal={message.rule_change}
                onDecide={onRuleChange}
                disabled={actionDisabled}
                currentPlanId={currentPlanId}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RuleChangeReview({
  proposal,
  onDecide,
  disabled,
  currentPlanId,
}: {
  proposal: RuleChangeProposal;
  onDecide?: (proposal: RuleChangeProposal, accept: boolean) => void;
  disabled?: boolean;
  currentPlanId?: string;
}) {
  const stale = proposal.plan_id !== currentPlanId;
  const resolved = proposal.status;
  return (
    <div className="mt-3 border-t border-divider pt-3 text-[13px] leading-normal">
      {proposal.reasons.map((reason) => (
        <p key={reason} className="mb-2">
          {reason}
        </p>
      ))}
      <p className="font-semibold">Remove</p>
      <ul className="mb-2 list-disc pl-5">
        {proposal.remove.map((rule) => (
          <li key={rule.id}>{rule.label}</li>
        ))}
      </ul>
      {proposal.add.length > 0 && (
        <>
          <p className="font-semibold">Add</p>
          <ul className="mb-2 list-disc pl-5">
            {proposal.add.map((rule) => (
              <li key={rule.id}>{rule.label}</li>
            ))}
          </ul>
        </>
      )}
      {resolved || stale ? (
        <output className="mt-2 block">
          {resolved === "applied"
            ? "Changes applied."
            : resolved === "declined"
              ? "Existing rules kept."
              : resolved === "unavailable"
                ? "Change could not be applied. Existing rules kept."
                : "This proposal belongs to an earlier draft. Send your request again to review it."}
        </output>
      ) : (
        <div className="course-chat-action flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled || !onDecide}
            onClick={() => onDecide?.(proposal, true)}
          >
            Apply changes
          </button>
          <button
            type="button"
            disabled={disabled || !onDecide}
            onClick={() => onDecide?.(proposal, false)}
          >
            Keep existing rules
          </button>
        </div>
      )}
    </div>
  );
}

/** User message: right aligned, max 88% wide, surface background. Always plain text. */
export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex animate-rise-in justify-end">
      <p className="max-w-[88%] whitespace-pre-wrap break-words border border-divider bg-surface px-[11px] py-[8px] text-[14px] leading-[1.5]">
        {text}
      </p>
    </div>
  );
}
