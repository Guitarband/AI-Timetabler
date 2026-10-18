/**
 * Page state. One reducer, one `phase` variable with 9 values (brief section 5).
 * Every component decides what to show from `phase` alone.
 *
 *   intake -> thinking -> confirm -> generating -> timetable -> adjust <-> adjusting
 *                                                                  \-> confirming -> confirmed
 *
 * Timetables and their conversations are restored from the account's database library.
 */

import type { PlannerSnapshot } from "./saved-timetables";
import type {
  Confirmation,
  Context,
  Message,
  Phase,
  Plan,
  Rule,
} from "./types";

export type ChatItem =
  | {
      id: string;
      role: "ai";
      message: Message;
      animate: boolean;
      error?: boolean;
    }
  | { id: string; role: "user"; text: string }
  | { id: string; role: "rules" };

export interface State {
  phase: Phase;
  context: Context | null;
  items: ChatItem[];
  /** Rules being edited in `confirm`; after a plan arrives, mirrors plan.rules (backend may add rules). */
  rules: Rule[];
  plan: Plan | null;
  /** Match % of the previous plan, for the ▲/▼ delta. null = no delta to show. */
  prevMatch: number | null;
  confirmation: Confirmation | null;
  /** Composer text. Kept in state so a failed request can put the text back. */
  draft: string;
  /** Bumped to ask the composer to focus its textarea ("Ask for a change"). */
  focusTick: number;
}

export type Action =
  | { type: "NEW_TIMETABLE"; context: Context }
  | { type: "OPEN_TIMETABLE"; snapshot: PlannerSnapshot }
  | { type: "CONTEXT_LOADED"; context: Context }
  | { type: "SET_PHASE"; phase: Phase }
  | { type: "USER_SAID"; text: string }
  | { type: "AI_SAID"; message: Message; animate?: boolean; error?: boolean }
  | { type: "RULES_PARSED"; rules: Rule[]; readyToBuild?: boolean }
  | { type: "RULES_EDITED"; rules: Rule[] }
  | { type: "PLAN_RECEIVED"; plan: Plan }
  | { type: "REOPENED"; plan: Plan }
  | {
      type: "RULE_CHANGE_RESOLVED";
      token: string;
      status: "applied" | "declined" | "unavailable";
    }
  | { type: "CONFIRMED"; confirmation: Confirmation }
  | { type: "SET_DRAFT"; text: string }
  | { type: "FOCUS_COMPOSER" };

export const initialState: State = {
  phase: "intake",
  context: null,
  items: [],
  rules: [],
  plan: null,
  prevMatch: null,
  confirmation: null,
  draft: "",
  focusTick: 0,
};

const nextId = (p: string) => `${p}-${crypto.randomUUID()}`;

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "NEW_TIMETABLE":
      return {
        ...initialState,
        context: action.context,
        focusTick: state.focusTick + 1,
        items: [
          {
            id: nextId("a"),
            role: "ai",
            message: action.context.greeting,
            animate: false,
          },
        ],
      };

    case "OPEN_TIMETABLE": {
      const snapshot = action.snapshot;
      const phase = snapshot.confirmation
        ? "confirmed"
        : snapshot.plan
          ? "adjust"
          : snapshot.rules.length ||
              snapshot.items.some((item) => item.role === "rules")
            ? "confirm"
            : "intake";
      const items = snapshot.items.map((item) =>
        item.role === "ai" ? { ...item, animate: false } : item,
      );
      if (isBusy(snapshot.phase))
        items.push({
          id: nextId("a"),
          role: "ai",
          animate: false,
          message: {
            steps: [],
            text: "The previous request was interrupted. Your saved conversation is restored; check the timetable before retrying.",
          },
        });
      return {
        ...initialState,
        ...snapshot,
        phase,
        items,
        focusTick: state.focusTick + 1,
      };
    }

    case "CONTEXT_LOADED":
      return { ...state, context: action.context };

    case "SET_PHASE":
      return { ...state, phase: action.phase };

    case "USER_SAID":
      return {
        ...state,
        items: [
          ...state.items,
          { id: nextId("u"), role: "user", text: action.text },
        ],
        draft: "",
      };

    case "AI_SAID":
      return {
        ...state,
        items: [
          ...state.items,
          {
            id: nextId("a"),
            role: "ai",
            message: action.message,
            animate: action.animate ?? true,
            error: action.error,
          },
        ],
      };

    case "RULE_CHANGE_RESOLVED":
      return {
        ...state,
        items: state.items.map((item) =>
          item.role === "ai" && item.message.rule_change?.token === action.token
            ? {
                ...item,
                message: {
                  ...item.message,
                  rule_change: {
                    ...item.message.rule_change,
                    status: action.status,
                  },
                },
              }
            : item,
        ),
      };

    case "RULES_PARSED":
      return {
        ...state,
        phase:
          action.rules.length > 0 || action.readyToBuild ? "confirm" : "intake",
        rules: action.rules,
        // The "What I understood" card lives in the conversation, right after the AI reply.
        items:
          action.rules.length === 0 && !action.readyToBuild
            ? state.items.filter((i) => i.role !== "rules")
            : state.items.some((i) => i.role === "rules")
              ? state.items
              : [...state.items, { id: nextId("r"), role: "rules" }],
      };

    case "RULES_EDITED":
      // Rules are only editable in `confirm` (brief section 6).
      return state.phase === "confirm"
        ? { ...state, rules: action.rules }
        : state;

    case "PLAN_RECEIVED": {
      const { plan } = action;
      if (!plan.changed && state.plan) {
        // Read-only answers and unapplied changes preserve the current draft.
        return state;
      }
      return {
        ...state,
        plan,
        rules: plan.rules,
        prevMatch: state.plan ? state.plan.match_pct : null,
      };
    }

    case "REOPENED":
      return {
        ...state,
        phase: "adjust",
        plan: action.plan,
        rules: action.plan.rules,
        confirmation: null,
        prevMatch: null,
        draft: "",
      };

    case "CONFIRMED":
      return { ...state, confirmation: action.confirmation };

    case "SET_DRAFT":
      return { ...state, draft: action.text };

    case "FOCUS_COMPOSER":
      return { ...state, focusTick: state.focusTick + 1 };
  }
}

/** Which of the 5 steps on the rail a phase belongs to (1-based). */
export function stepOf(phase: Phase): number {
  switch (phase) {
    case "intake":
    case "thinking":
      return 1;
    case "confirm":
      return 2;
    case "generating":
    case "timetable":
      return 3;
    case "adjust":
    case "adjusting":
      return 4;
    case "confirming":
    case "confirmed":
      return 5;
  }
}

/** Phases where a request is in flight: every API button is disabled to stop double submits. */
export const BUSY_PHASES: Phase[] = [
  "thinking",
  "generating",
  "adjusting",
  "confirming",
];
export const isBusy = (p: Phase) => BUSY_PHASES.includes(p);
