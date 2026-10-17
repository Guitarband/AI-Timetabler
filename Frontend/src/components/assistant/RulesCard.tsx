"use client";
import { COPY } from "@/lib/copy";
import {
  ADD_LABEL,
  addSuggestions,
  invalidFriendRules,
  newRule,
  remainingFriends,
} from "@/lib/rules";
import type { Rule } from "@/lib/types";
import { Blueprint } from "../ui/Blueprint";
import { Button } from "../ui/Button";
import { RuleCard } from "./RuleCard";

/**
 * "What I understood": the step that proves the AI does not guess.
 * The user sees and fixes the rules before anything is planned.
 * Editable only while phase === "confirm"; locked afterwards.
 */
export function RulesCard({
  rules,
  friends,
  editable,
  busy,
  onChange,
  onBuild,
}: {
  rules: Rule[];
  friends: string[];
  editable: boolean;
  busy: boolean;
  onChange: (rules: Rule[]) => void;
  onBuild: () => void;
}) {
  const suggestions = addSuggestions(rules, friends);
  const invalid = invalidFriendRules(rules);

  return (
    <Blueprint className="ml-[36px] animate-rise-in bg-bg p-[12px]">
      <div className="mb-[9px] flex items-baseline justify-between gap-[8px]">
        <h4 className="font-display text-[16px] font-semibold leading-none">
          {COPY.rulesCard.title}
        </h4>
        <span className="text-[11px] ink-55">
          {COPY.rulesCard.count(rules.length)}
        </span>
      </div>

      {rules.length === 0 ? (
        <p className="border border-dashed border-divider px-[10px] py-[9px] text-[12px] ink-55">
          All required classes, no clashes. Extra preferences are optional.
        </p>
      ) : (
        <ul className="flex flex-col gap-[6px]">
          {rules.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              locked={!editable}
              onChange={(next) =>
                onChange(rules.map((x) => (x.id === r.id ? next : x)))
              }
              onRemove={() => onChange(rules.filter((x) => x.id !== r.id))}
            />
          ))}
        </ul>
      )}

      {editable && (
        <>
          {suggestions.length > 0 && (
            <div className="mt-[9px] flex flex-wrap items-center gap-[6px]">
              <span className="eyebrow mr-[2px] ink-55">
                {COPY.rulesCard.addRule}
              </span>
              {suggestions.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() =>
                    onChange([
                      ...rules,
                      newRule(kind, remainingFriends(rules, friends)),
                    ])
                  }
                  className="border border-divider px-[7px] py-[2px] text-[12px] ink-70 hover:border-accent-300 hover:bg-accent-100"
                >
                  +{" "}
                  {kind === "friend" && rules.some((r) => r.kind === "friend")
                    ? "Match another friend"
                    : ADD_LABEL[kind]}
                </button>
              ))}
            </div>
          )}
          {invalid && (
            <p role="alert" className="mt-[9px] text-[12px]">
              Enter a name for each friend and choose each friend only once.
            </p>
          )}
          <Button
            variant="primary"
            className="mt-[12px] w-full"
            disabled={busy || invalid}
            onClick={onBuild}
          >
            {COPY.rulesCard.build}
          </Button>
        </>
      )}
    </Blueprint>
  );
}
