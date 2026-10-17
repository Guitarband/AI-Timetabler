import { COPY } from "@/lib/copy";
import type { Section } from "@/lib/types";

/**
 * "Courses in this plan": one row per course code (code column 78px), title, its sections joined by " · ", credits.
 * Course credits = the highest `credits` among its sections.
 * BACKEND: confirm whether `Section.credits` is per course or per section. If per section, change to a sum here.
 */
export function CourseList({ sections }: { sections: Section[] }) {
  const byCode = new Map<
    string,
    { title: string; parts: string[]; credits: number }
  >();
  for (const s of sections) {
    const row = byCode.get(s.code) ?? { title: s.title, parts: [], credits: 0 };
    row.parts.push(`${s.kind} ${s.section}`);
    row.credits = Math.max(row.credits, s.credits);
    byCode.set(s.code, row);
  }

  return (
    <section>
      <h5 className="eyebrow border-b border-divider pb-[6px] ink-62">
        {COPY.audit.courses}
      </h5>
      <ul>
        {[...byCode.entries()].map(([code, row]) => (
          <li
            key={code}
            className="flex items-start gap-[8px] border-b border-divider py-[7px]"
          >
            <span className="w-[78px] shrink-0 font-display text-[13px] font-semibold leading-[1.35]">
              {code}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-[1.35]">{row.title}</p>
              <p className="text-[11px] leading-[1.4] ink-55">
                {row.parts.join(" · ")}
              </p>
            </div>
            <span className="shrink-0 text-[11px] leading-[1.6] ink-55">
              {COPY.audit.credits(row.credits)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
