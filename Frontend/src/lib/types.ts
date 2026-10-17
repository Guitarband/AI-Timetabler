/**
 * Re-export of the shared API contract (packages/shared) plus UI-only types.
 * Components import types from here so they never reach into packages/ directly.
 */
export type {
  Confirmation,
  Context,
  FriendMatch,
  KnownRuleKind,
  Message,
  ParseResponse,
  Plan,
  PlanSummary,
  Rule,
  RuleKind,
  RuleScore,
  RuleStatus,
  Section,
  Weekday,
} from "./enrolment-contract";

/** The single variable that drives the whole page (Frontend Brief, section 5). */
export type Phase =
  | "intake"
  | "thinking"
  | "confirm"
  | "generating"
  | "timetable"
  | "adjust"
  | "adjusting"
  | "confirming"
  | "confirmed";

export type AssistantSpeed = "cinematic" | "normal" | "instant";
