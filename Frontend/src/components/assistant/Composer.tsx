"use client";
import { useEffect, useRef } from "react";
import { COPY, truncateChip } from "@/lib/copy";
import type { Phase } from "@/lib/types";
import { Button } from "../ui/Button";
import { LockIcon } from "../ui/Icons";

/**
 * Composer: quick chips, textarea (min 62px), hint on the left, send button on the right.
 *   Enter = send, Shift+Enter = new line. Empty/whitespace never sends.
 *   Enabled in `intake`, `confirm`, and `adjust` so a failed build can be revised.
 *   intake chips append to the textarea (comma separated, not sent); adjust chips send at once.
 *   In `confirmed` the composer is replaced by a locked line.
 */
export function Composer({
  phase,
  draft,
  friendName,
  focusTick,
  lockedText,
  disabled = false,
  onDraft,
  onSend,
}: {
  phase: Phase;
  draft: string;
  friendName?: string;
  focusTick: number;
  lockedText?: string;
  disabled?: boolean;
  onDraft: (text: string) => void;
  onSend: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const open =
    !disabled &&
    (phase === "intake" || phase === "confirm" || phase === "adjust");
  const canSend = open && draft.trim().length > 0;

  useEffect(() => {
    if (focusTick > 0) ref.current?.focus();
  }, [focusTick]);

  // Put the cursor back in the box when it reopens (after a reply or an error).
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (phase === "confirmed") {
    return (
      <div className="flex items-center gap-[8px] border-t border-divider px-[14px] py-[13px] text-[12px] ink-62">
        <LockIcon size={14} className="shrink-0 text-accent" />
        <span>{lockedText}</span>
      </div>
    );
  }

  const copy =
    phase === "intake"
      ? COPY.composer.intake
      : phase === "confirm"
        ? COPY.composer.confirm
        : phase === "adjust"
          ? COPY.composer.adjust
          : COPY.composer.busy;
  const placeholder =
    phase === "intake"
      ? COPY.composer.intake.placeholder(friendName)
      : phase === "confirm"
        ? COPY.composer.confirm.placeholder
        : phase === "adjust"
          ? COPY.composer.adjust.placeholder
          : COPY.composer.busy.placeholder;
  const chips =
    phase === "intake"
      ? COPY.chips.intake(friendName)
      : phase === "adjust"
        ? COPY.chips.adjust(friendName)
        : [];

  const send = () => {
    if (!canSend) return;
    onSend(draft.trim());
  };

  const onChip = (chip: string) => {
    if (!open) return;
    if (phase === "intake") {
      const cur = draft.trim().replace(/[,\s]+$/, "");
      onDraft(cur ? `${cur}, ${chip}` : chip);
      ref.current?.focus();
    } else if (phase === "adjust") {
      onSend(chip);
    }
  };

  return (
    <div className="border-t border-divider px-[14px] py-[11px]">
      {chips.length > 0 && (
        <div className="mb-[8px] flex flex-wrap gap-[6px]">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              title={chip}
              disabled={!open}
              onClick={() => onChip(chip)}
              className="border border-divider px-[8px] py-[3px] text-[12px] leading-[1.4] ink-70 hover:border-accent-300 hover:bg-accent-100"
            >
              {truncateChip(chip)}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        value={draft}
        maxLength={10_000}
        disabled={!open}
        placeholder={placeholder}
        aria-label="Message the assistant"
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        className="block min-h-[62px] w-full resize-none border border-divider bg-surface px-[10px] py-[8px] text-[14px] leading-[1.5] placeholder:text-[color:color-mix(in_srgb,var(--color-text)_40%,transparent)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent disabled:opacity-60"
      />
      <div className="mt-[8px] flex items-center justify-between gap-[10px]">
        <span className="text-[11px] ink-50">{copy.hint}</span>
        <Button variant="primary" disabled={!canSend} onClick={send}>
          {copy.button}
        </Button>
      </div>
    </div>
  );
}
