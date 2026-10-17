import { COPY } from "@/lib/copy";
import { stepOf } from "@/lib/reducer";
import type { Phase } from "@/lib/types";
import { CheckIcon } from "./ui/Icons";

/**
 * 5-step rail. Box 18x18, 3 states:
 *   done     -> accent fill + check
 *   current  -> accent border + number
 *   upcoming -> grey border + faded number
 * Connector lines are 22px, labels 12px uppercase.
 */
export function StepRail({ phase }: { phase: Phase }) {
  const current = stepOf(phase);
  return (
    <ol className="flex items-center" aria-label="Enrolment steps">
      {COPY.steps.map((label, i) => {
        const n = i + 1;
        const state =
          n < current ? "done" : n === current ? "current" : "upcoming";
        return (
          <li
            key={label}
            className="flex items-center"
            aria-current={state === "current" ? "step" : undefined}
          >
            {i > 0 && (
              <span aria-hidden className="mx-[8px] h-px w-[22px] bg-divider" />
            )}
            <span
              className={[
                "flex h-[18px] w-[18px] items-center justify-center border font-display text-[11px] font-semibold leading-none",
                state === "done" && "border-accent bg-accent text-bg",
                state === "current" && "border-accent text-accent-700",
                state === "upcoming" && "border-divider ink-40",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {state === "done" ? <CheckIcon size={12} /> : n}
            </span>
            <span
              className={`eyebrow ml-[7px] text-[12px] ${state === "upcoming" ? "ink-40" : "ink-70"}`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
