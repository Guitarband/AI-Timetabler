import { DAY_PLURAL, fmtMin } from "./time";
import type { KnownRuleKind, Rule } from "./types";

/**
 * Frontend helpers for the rule cards in the Confirm step.
 *
 * IMPORTANT: Turning free text into rules is the BACKEND's job (POST /parse).
 * Nothing here parses user text. These helpers only:
 *   - re-label a KNOWN rule after the user edits its control (+/- 30 min, friend name),
 *   - build a new rule when the user picks one from "Add a rule".
 * Labels the backend sends are always shown as-is.
 */

export const EARLIEST_MIN = 8 * 60; // 08:00
export const LATEST_MAX = 20 * 60; // 20:00
export const STEP_MIN = 30;

/** Kinds offered under "Add a rule", in this order. */
export const ADDABLE_KINDS: KnownRuleKind[] = [
  "earliest",
  "latest",
  "dayoff",
  "nolabs",
  "lunch",
  "friend",
];

export function isKnownKind(kind: string): kind is KnownRuleKind {
  return (ADDABLE_KINDS as string[]).includes(kind);
}

/** Label for a known kind + value. Matches the prototype copy (brief section 6). */
export function labelFor(kind: KnownRuleKind, value: number | string): string {
  switch (kind) {
    case "earliest":
      return `No classes before ${fmtMin(Number(value))}`;
    case "latest":
      return `Nothing after ${fmtMin(Number(value))}`;
    case "dayoff":
      return `${DAY_PLURAL[Number(value) - 1] ?? "Fridays"} free`;
    case "nolabs":
      return "No back-to-back labs";
    case "lunch":
      return `Keep a ${Number(value) || 45}-minute lunch break`;
    case "friend":
      return `Match timetable with ${String(value).trim() || "a friend"}`;
  }
}

/** Short label used on the "Add a rule" suggestion buttons. */
export const ADD_LABEL: Record<KnownRuleKind, string> = {
  earliest: "Earliest start",
  latest: "Latest finish",
  dayoff: "Day off",
  nolabs: "No back-to-back labs",
  lunch: "Lunch break",
  friend: "Match a friend",
};

/** Default value for a rule added by the user. */
export function defaultValue(
  kind: KnownRuleKind,
  friends: string[],
): number | string {
  switch (kind) {
    case "earliest":
      return 10 * 60;
    case "latest":
      return 16 * 60;
    case "dayoff":
      return 5;
    case "nolabs":
      return 1;
    case "lunch":
      return 45;
    case "friend":
      return friends[0] ?? "";
  }
}

let localId = 0;
export function newRule(kind: KnownRuleKind, friends: string[]): Rule {
  const value = defaultValue(kind, friends);
  localId += 1;
  return {
    // Local id only. BACKEND: /solve receives the full rule list, ids are opaque to the solver.
    id: `local-${kind}-${Date.now()}-${localId}`,
    kind,
    value,
    label: labelFor(kind, value),
    source: "added by you",
  };
}

export function remainingFriends(rules: Rule[], friends: string[]): string[] {
  const selected = new Set(
    rules
      .filter((r) => r.kind === "friend")
      .map((r) => String(r.value).trim().toLowerCase()),
  );
  return friends.filter((name) => !selected.has(name.trim().toLowerCase()));
}

export function invalidFriendRules(rules: Rule[]): boolean {
  const names = rules
    .filter((r) => r.kind === "friend")
    .map((r) => String(r.value).trim().toLowerCase());
  return names.some((name) => !name) || new Set(names).size !== names.length;
}

/** Keep another shared friend accessible even after the first friend rule. */
export function addSuggestions(
  rules: Rule[],
  friends: string[] = [],
): KnownRuleKind[] {
  const have = new Set(rules.map((r) => r.kind));
  const suggestions = ADDABLE_KINDS.filter(
    (k) => k !== "friend" && !have.has(k),
  );
  if (remainingFriends(rules, friends).length) suggestions.unshift("friend");
  return suggestions.slice(0, 3);
}

/** +/- 30 min for earliest/latest, clamped to 08:00..20:00. */
export function nudgeTime(rule: Rule, deltaMin: number): Rule {
  if (rule.kind !== "earliest" && rule.kind !== "latest") return rule;
  const next = Math.min(
    LATEST_MAX,
    Math.max(EARLIEST_MIN, Number(rule.value) + deltaMin),
  );
  return {
    ...rule,
    value: next,
    label: labelFor(rule.kind as "earliest" | "latest", next),
  };
}

export function renameFriend(rule: Rule, name: string): Rule {
  return { ...rule, value: name, label: labelFor("friend", name) };
}

export function friendFirstName(
  rules: Rule[],
  fallback?: string,
): string | null {
  const r = rules.find((x) => x.kind === "friend");
  if (!r) return null;
  const full = String(r.value || fallback || "").trim();
  return full.split(/\s+/)[0] || null;
}
