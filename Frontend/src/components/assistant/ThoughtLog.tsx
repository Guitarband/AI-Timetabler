import { CheckIcon } from "../ui/Icons";

/**
 * Thought log: one 12px line per backend step. While a line is "running" it shows a
 * blinking square dot, then the dot turns into a check (markIn animation).
 * Never invent lines on the frontend: while waiting for a response show <ThinkingIndicator/> only.
 */
export function ThoughtLog({
  steps,
  shown,
  checked,
}: {
  steps: string[];
  shown: number;
  checked: number;
}) {
  if (shown === 0) return null;
  return (
    <ul
      className="mb-[8px] border-l border-divider pl-[10px]"
      aria-label="What the assistant did"
    >
      {steps.slice(0, shown).map((step, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: Steps only append during this immutable message's reveal.
          key={i}
          className="flex animate-rise-in items-center gap-[7px] py-[1px] text-[12px] leading-[1.5] ink-55"
        >
          <span className="flex h-[12px] w-[12px] shrink-0 items-center justify-center">
            {i < checked ? (
              <CheckIcon size={12} className="animate-mark-in text-accent" />
            ) : (
              <span className="block h-[5px] w-[5px] animate-dot-pulse bg-accent" />
            )}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ul>
  );
}
