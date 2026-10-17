"use client";
import { useReveal } from "@/hooks/useReveal";
import type { Message as AssistantMessage } from "@/lib/types";
import { ThoughtLog } from "./ThoughtLog";

/** AI message: 26x26 "AI" avatar, then thought log, main text (14px) and an optional note (accent-100, 12px). */
export function AiMessage({
  message,
  animate,
  error,
  onAction,
  actionDisabled,
}: {
  message: AssistantMessage;
  animate: boolean;
  error?: boolean;
  onAction?: (action: NonNullable<AssistantMessage["action"]>) => void;
  actionDisabled?: boolean;
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
          </div>
        )}
      </div>
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
