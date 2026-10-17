import { COPY } from "@/lib/copy";

/** 3 square 5px dots blinking 0.15s apart + "working". Shown while a request is in flight. */
export function ThinkingIndicator() {
  return (
    <output
      className="flex animate-rise-in items-center gap-[10px] pl-[36px]"
      aria-live="polite"
    >
      <span className="flex items-center gap-[4px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block h-[5px] w-[5px] animate-dot-pulse bg-accent"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
      <span className="text-[12px] ink-55">{COPY.working}</span>
    </output>
  );
}
