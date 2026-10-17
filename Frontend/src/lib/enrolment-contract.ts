/**
 * API contract for the Enrolment Assistant (Frontend Brief, section 8).
 *
 * Implemented by the Flask service in /Backend:
 *   GET  /context                     -> Context
 *   POST /parse    { text }           -> ParseResponse
 *   POST /solve    { rules }          -> Plan
 *   POST /adjust   { plan_id, text }  -> Plan
 *   POST /confirm  { plan_id }        -> Confirmation
 *
 * Pydantic models in Backend/enrolment/models.py mirror these shapes.
 * Field names are snake_case on purpose so they match the JSON on the wire.
 */

/** Kinds the UI knows how to render controls for. Unknown kinds still render (label only). */
export type KnownRuleKind =
  | "earliest"
  | "latest"
  | "dayoff"
  | "nolabs"
  | "lunch"
  | "friend";

// `(string & {})` keeps autocomplete for known kinds while still accepting any string from the backend.
export type RuleKind = KnownRuleKind | (string & {});

export interface Rule {
  id: string;
  kind: RuleKind; // picks the control shown on the rule card
  value: number | string; // minutes from midnight, day number 1-5, or a friend's name
  label: string; // "No classes before 10:00" (rendered as-is, never built on the frontend)
  source: string; // the words the user typed, or "added by you"
}

/** One AI message. */
export interface RuleChangeProposal {
  plan_id: string;
  token: string;
  remove: Rule[];
  add: Rule[];
  reasons: string[];
  status?: "applied" | "declined" | "unavailable";
}

export interface Message {
  steps: string[]; // thought log lines, may be []
  text: string;
  note?: string;
  action?: "course_onboarding" | "new_timetable";
  rule_change?: RuleChangeProposal;
}

export type Weekday = 1 | 2 | 3 | 4 | 5; // 1 = Monday

export interface Section {
  key: string;
  code: string; // "PSYC 1010"
  title: string;
  kind: string; // Lecture, Lab, Tutorial, Workshop, Seminar
  section: string; // "L-02"
  day: Weekday;
  start: string; // "10:00"
  end: string; // "11:30"
  room: string;
  credits: number;
  with_friend: boolean;
  shared_with?: string[]; // actual friends in this section; absent in older saved plans
  changed: boolean; // moved by the latest request
}

export type RuleStatus = "met" | "partial" | "unmet";

export interface RuleScore {
  rule_id: string;
  label: string;
  status: RuleStatus;
  note: string;
}

export interface FriendMatch {
  name: string;
  shared: number;
  total: number;
  text: string;
}

export interface PlanSummary {
  sections: number;
  credits: number;
  hold_minutes: number;
}

export interface Plan {
  plan_id: string;
  version: number; // 1, 2, 3 ...
  changed: boolean; // false = the request could not be done, timetable unchanged
  rules: Rule[]; // includes rules the backend added on its own
  sections: Section[];
  kept_sections?: string[];
  match_pct: number; // 0-100
  scores: RuleScore[];
  friend?: FriendMatch;
  friends?: FriendMatch[]; // per-friend results; friend is the legacy first result
  summary: PlanSummary;
  message: Message;
  /** Optional, used for the panel description. Falls back to Context.published_sections. */
  source_sections?: number;
}

export interface Context {
  student_name: string;
  term: string; // "Fall 2026"
  approved_courses: number;
  published_sections: number;
  friends: string[];
  greeting: Message;
}

export interface Confirmation {
  reference: string;
  confirmed_at: string; // ISO 8601
  courses: number;
  sections: number;
  credits: number;
  swap_deadline: string; // ISO date
  message: Message;
}

export interface ParseResponse {
  rules: Rule[];
  message: Message;
  ready_to_build?: boolean;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClassAlternatives {
  plan_id: string;
  current: Section;
  kept: boolean;
  options: {
    section: Section;
    remaining_seats?: number | null;
    can_swap: boolean;
    reasons: string[];
    preference_notes: string[];
  }[];
}
