"use client";
import { COPY } from "@/lib/copy";
import {
  EARLIEST_MIN,
  LATEST_MAX,
  nudgeTime,
  renameFriend,
  STEP_MIN,
} from "@/lib/rules";
import type { Rule } from "@/lib/types";

/**
 * One rule: accent-100 background, accent-300 border.
 *   line 1: label (15px heading) + control for its kind + remove (×)
 *   line 2: from "what the user typed" (11px)
 * Controls by kind: earliest/latest -> -/+ 30 min (08:00..20:00) · friend -> name input (max 190px) · others -> none.
 * Unknown kinds from the backend render label only.
 */
export function RuleCard({
  rule,
  locked,
  onChange,
  onRemove,
}: {
  rule: Rule;
  locked: boolean;
  onChange: (r: Rule) => void;
  onRemove: () => void;
}) {
  const kind = rule.kind;
  const timeKind = kind === "earliest" || kind === "latest";
  const v = Number(rule.value);

  return (
    <li className="animate-rise-in border border-accent-300 bg-accent-100 px-[10px] py-[7px]">
      <div className="flex items-center gap-[8px]">
        <span className="min-w-0 flex-1 font-display text-[15px] font-semibold leading-[1.3] text-accent-900">
          {rule.label}
        </span>

        {timeKind && (
          <fieldset
            className="flex shrink-0 items-center"
            aria-label="Adjust time"
          >
            <StepBtn
              label="30 minutes earlier"
              disabled={locked || v - STEP_MIN < EARLIEST_MIN}
              onClick={() => onChange(nudgeTime(rule, -STEP_MIN))}
            >
              −
            </StepBtn>
            <StepBtn
              label="30 minutes later"
              disabled={locked || v + STEP_MIN > LATEST_MAX}
              onClick={() => onChange(nudgeTime(rule, STEP_MIN))}
            >
              +
            </StepBtn>
          </fieldset>
        )}

        {!locked && (
          <button
            type="button"
            aria-label={`${COPY.rulesCard.remove}: ${rule.label}`}
            onClick={onRemove}
            className="flex h-[20px] w-[20px] shrink-0 items-center justify-center text-[15px] leading-none text-accent-800 hover:bg-accent-200"
          >
            ×
          </button>
        )}
      </div>
      {kind === "friend" && (
        <input
          aria-label={COPY.rulesCard.friendName}
          className="mt-[5px] block w-full max-w-[190px] border border-accent-300 bg-bg px-[6px] py-[2px] text-[12px] disabled:opacity-60"
          value={String(rule.value)}
          disabled={locked}
          onChange={(e) => onChange(renameFriend(rule, e.target.value))}
        />
      )}
      {/* `source` may be what the user typed: plain text only. */}
      <p className="mt-[1px] truncate text-[11px] text-accent-800">
        {rule.source === "added by you"
          ? rule.source
          : rule.source
            ? `from “${rule.source}”`
            : null}
      </p>
    </li>
  );
}

function StepBtn({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="-ml-px flex h-[22px] w-[22px] items-center justify-center border border-accent-300 bg-bg text-[14px] leading-none text-accent-800 hover:bg-accent-200 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
