import { COPY } from "@/lib/copy";
import type { RuleScore } from "@/lib/types";
import { Tag, type TagTone } from "../ui/Tag";

const TONE: Record<RuleScore["status"], TagTone> = {
  met: "accent",
  partial: "neutral",
  unmet: "outline",
};

/** "How your rules scored": label 13px, note 11px, status tag on the right. Met / Partly met / Traded off. */
export function RuleScores({ scores }: { scores: RuleScore[] }) {
  return (
    <section>
      <h5 className="eyebrow border-b border-divider pb-[6px] ink-62">
        {COPY.audit.scored}
      </h5>
      {scores.length === 0 && (
        <p className="py-2 text-sm ink-62">
          No optional preferences. All required classes are included without
          clashes.
        </p>
      )}
      <ul>
        {scores.map((s) => (
          <li
            key={s.rule_id}
            className="flex items-start justify-between gap-[10px] border-b border-divider py-[7px]"
          >
            <div className="min-w-0">
              <p className="text-[13px] leading-[1.35]">{s.label}</p>
              {s.note && (
                <p className="text-[11px] leading-[1.4] ink-55">{s.note}</p>
              )}
            </div>
            <Tag tone={TONE[s.status]} className="mt-[1px] shrink-0">
              {COPY.audit.status[s.status]}
            </Tag>
          </li>
        ))}
      </ul>
    </section>
  );
}
