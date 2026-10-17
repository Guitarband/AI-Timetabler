import { COPY } from "@/lib/copy";

/** 3 swatches (12px). "Shared with <friend>" is hidden when there is no friend rule. */
export function Legend({ friendFirst }: { friendFirst: string | null }) {
  const items = [
    {
      label: COPY.legend.yours,
      cls: "bg-neutral-100 border-divider border-l-accent-300",
    },
    friendFirst
      ? {
          label: COPY.legend.shared(friendFirst),
          cls: "bg-accent-100 border-accent-400 border-l-accent-600",
        }
      : null,
    {
      label: COPY.legend.changed,
      cls: "bg-accent-200 border-accent-700 border-l-accent-700",
    },
  ].filter(Boolean) as { label: string; cls: string }[];

  return (
    <ul className="mt-[10px] flex flex-wrap gap-x-[18px] gap-y-[4px] pl-[54px]">
      {items.map((it) => (
        <li
          key={it.label}
          className="flex items-center gap-[6px] text-[11px] ink-62"
        >
          <span
            aria-hidden
            className={`block h-[12px] w-[12px] border border-l-[3px] ${it.cls}`}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
