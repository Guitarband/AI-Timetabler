"use client";
import { useEffect, useRef } from "react";
import { COPY } from "@/lib/copy";
import type { ChatItem } from "@/lib/reducer";
import type { Message, Phase, Rule } from "@/lib/types";
import { Blueprint } from "../ui/Blueprint";
import { Composer } from "./Composer";
import { AiMessage, UserMessage } from "./Message";
import { RulesCard } from "./RulesCard";
import { ThinkingIndicator } from "./ThinkingIndicator";

/**
 * Left panel, fixed 428px: header (status line) / conversation (scrolls) / composer (pinned).
 */
export function AssistantPanel(props: {
  phase: Phase;
  items: ChatItem[];
  rules: Rule[];
  friends: string[];
  waiting: boolean;
  draft: string;
  focusTick: number;
  lockedText?: string;
  onDraft: (t: string) => void;
  onSend: (t: string) => void;
  onRulesChange: (r: Rule[]) => void;
  onBuild: () => void;
  onAction?: (action: NonNullable<Message["action"]>) => void;
}) {
  const { phase, items, waiting } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Stick to the bottom whenever content grows, including each thought log tick.
  useEffect(() => {
    const el = contentRef.current;
    const box = scrollRef.current;
    if (!el || !box) return;
    const ro = new ResizeObserver(() =>
      box.scrollTo({ top: box.scrollHeight, behavior: "smooth" }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const status =
    phase === "confirmed"
      ? COPY.status.complete
      : ["thinking", "generating", "adjusting", "confirming"].includes(phase)
        ? COPY.status.working
        : COPY.status.listening;

  return (
    <Blueprint
      as="section"
      aria-label={COPY.assistant}
      className="planner-assistant flex min-h-0 min-w-0 flex-col bg-bg"
    >
      <div className="flex items-center justify-between border-b border-divider px-[14px] py-[11px]">
        <span className="flex items-center gap-[8px]">
          <span aria-hidden className="block h-[7px] w-[7px] bg-accent" />
          <span className="eyebrow ink-70">{COPY.assistant}</span>
        </span>
        <span className="text-[11px] ink-50" aria-live="polite">
          {status}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto"
      >
        <div ref={contentRef} className="flex flex-col gap-[14px] p-[14px]">
          {items.map((item) => {
            if (item.role === "user")
              return <UserMessage key={item.id} text={item.text} />;
            if (item.role === "ai")
              return (
                <AiMessage
                  key={item.id}
                  message={item.message}
                  animate={item.animate}
                  error={item.error}
                  onAction={props.onAction}
                  actionDisabled={waiting}
                />
              );
            return (
              <RulesCard
                key={item.id}
                rules={props.rules}
                friends={props.friends}
                editable={phase === "confirm"}
                busy={waiting}
                onChange={props.onRulesChange}
                onBuild={props.onBuild}
              />
            );
          })}
          {waiting && <ThinkingIndicator />}
        </div>
      </div>

      <Composer
        phase={phase}
        disabled={waiting}
        draft={props.draft}
        friendName={props.friends[0]}
        focusTick={props.focusTick}
        lockedText={props.lockedText}
        onDraft={props.onDraft}
        onSend={props.onSend}
      />
    </Blueprint>
  );
}
