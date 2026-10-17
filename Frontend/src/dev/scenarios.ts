/**
 * DEV-ONLY: mock scenarios.
 * ------------------------------------------------------------------
 * Lets anyone (designers, backend, reviewers) click through every state the UI handles,
 * including the edge cases from the brief (section 9), without a backend.
 *
 * How it works: wraps the normal mock API and bends ONE behaviour per scenario
 * (an error, an empty parse, a slow reply...). The scenario is picked from the URL: `/?scenario=parse-empty`.
 *
 * TO REMOVE ALL DEV TOOLS: delete the `src/dev/` folder and the 2 lines marked `DEV-ONLY` in
 * `src/lib/api.ts` and `src/app/page.tsx`. Nothing else depends on this folder.
 */
import type { EnrolmentApi } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import type { Plan, Section } from "@/lib/types";

export interface Scenario {
  id: string;
  title: string;
  /** What the person should do, step by step. */
  try: string[];
  /** What they should see. Also tells the backend what the UI expects from them. */
  expect: string;
  /** Which part of the contract this exercises, for the backend reader. */
  backend: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "happy",
    title: "Happy path (default)",
    try: [
      "Type: No classes before 10, keep Fridays free, and match my timetable with Maya Okafor",
      "Edit a rule if you like, then press “Looks right — build my timetable”",
      "Click the chip “Move my Wednesday workshop earlier…”",
      "Press “Confirm enrolment”",
    ],
    expect:
      "3 rule cards, draft v1 at 90%, then v2 at 92% (▲ +2) with WRIT 1000 marked JUST CHANGED, then the confirmation card.",
    backend:
      "GET /context → POST /parse → POST /solve → POST /adjust (changed: true) → POST /confirm",
  },
  {
    id: "friend-cost",
    title: "Request with a cost (match % drops)",
    try: [
      "Do the happy path up to the timetable",
      "Click the chip “Put me in Maya's seminar”",
      "Then click “Undo the last change”",
    ],
    expect:
      "PHIL 1100 moves to Friday 09:00, Friday stripes disappear, match drops (▼). Undo puts it back as a new version.",
    backend:
      "POST /adjust can lower match_pct. `scores` must say which rules are now unmet. Undo is just another /adjust.",
  },
  {
    id: "parse-empty",
    title: "Nothing understood",
    try: ["Type anything and press Send"],
    expect:
      "AI says it won't guess. Card shows “Nothing captured yet”. Build is disabled until you use “Add a rule”.",
    backend:
      "POST /parse returns `rules: []` with a message. Never guess a rule.",
  },
  {
    id: "no-friend",
    title: "No friend rule",
    try: [
      "Type: No classes before 10 and keep Fridays free",
      "Build the timetable",
    ],
    expect:
      "No friend strip, no “Shared with…” legend item, no WITH tags on blocks.",
    backend: "Plan.friend omitted, Section.with_friend false for all.",
  },
  {
    id: "adjust-unchanged",
    title: "Change request that can't be done",
    try: ["Build a timetable", "Send any change request"],
    expect: "AI explains why. Timetable, version tag and match % do not move.",
    backend:
      "POST /adjust returns `changed: false` and the SAME version and sections.",
  },
  {
    id: "outside-hours",
    title: "Sections outside 09:00–18:00",
    try: ["Build a timetable"],
    expect:
      "Grid grows to 08:00–20:00 so the early and late blocks are not cut off.",
    backend:
      "Any start/end time is fine. The UI sizes the grid from the sections it gets.",
  },
  {
    id: "slow",
    title: "Slow backend (6s)",
    try: ["Send a message, build, adjust or confirm"],
    expect:
      "Working dots stay up the whole time. Buttons that call the API are disabled (no double submit).",
    backend:
      "No timeout below 30s on the frontend. Anything slower shows the error case.",
  },
  {
    id: "parse-error",
    title: "API error on Send",
    try: ["Type something and press Send"],
    expect:
      "Error shows as an AI message with the backend's `detail` as a note. Your text is back in the box to resend.",
    backend:
      'Non-2xx with `{ "detail": "..." }`. The detail is shown to the student, keep it human.',
  },
  {
    id: "solve-error",
    title: "API error on build",
    try: ["Type preferences, press Send", "Press build"],
    expect:
      "Error message, and you are back on the editable rule card to try again.",
    backend: "Same error shape on POST /solve.",
  },
  {
    id: "confirm-timeout",
    title: "Timeout on Confirm",
    try: ["Build a timetable", "Press “Confirm enrolment”"],
    expect:
      "After the wait, an error message. You stay in Adjust and can confirm again.",
    backend:
      "POST /confirm must be safe to call twice (idempotent per plan_id).",
  },
];

export function currentScenarioId(): string {
  if (typeof window === "undefined") return "happy";
  const id =
    new URLSearchParams(window.location.search).get("scenario") ?? "happy";
  return SCENARIOS.some((s) => s.id === id) ? id : "happy";
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withEdgeSections(plan: Plan): Plan {
  const extra: Section[] = [
    {
      key: "math-0800",
      code: "MATH 1005",
      title: "Bridging Mathematics",
      kind: "Tutorial",
      section: "T-01",
      day: 1,
      start: "08:00",
      end: "09:00",
      room: "Kerr 012",
      credits: 0,
      with_friend: false,
      changed: false,
    },
    {
      key: "chem-1830",
      code: "CHEM 1001",
      title: "Chemistry Foundations",
      kind: "Lab",
      section: "N-02",
      day: 4,
      start: "18:00",
      end: "19:30",
      room: "Wet Lab 1",
      credits: 0,
      with_friend: false,
      changed: false,
    },
  ];
  return {
    ...plan,
    sections: [...plan.sections, ...extra],
    summary: {
      ...plan.summary,
      sections: plan.summary.sections + extra.length,
    },
  };
}

/** Wraps the mock API with the behaviour of the scenario in the URL. */
export function withScenario(base: EnrolmentApi): EnrolmentApi {
  const id = currentScenarioId();
  const fail = (detail: string) => new ApiError(detail, 500, "http");

  return {
    ...base,
    async getContext() {
      const ctx = await base.getContext();
      return id === "no-friend" ? { ...ctx, friends: [] } : ctx;
    },
    async parse(text, history) {
      if (id === "slow") await wait(6000);
      if (id === "parse-error") {
        await wait(700);
        throw fail(
          "The rule parser is not responding (scenario: parse-error).",
        );
      }
      if (id === "parse-empty") {
        await base.parse(text, history); // keep the normal latency
        return {
          rules: [],
          message: {
            steps: [
              "Reading what you wrote",
              "Matched 0 phrases to rules I can check",
            ],
            text: "I couldn't turn that into a rule I can check, so I won't guess. Try something like “no classes before 10”, or add a rule below.",
          },
        };
      }
      const res = await base.parse(text, history);
      return id === "no-friend"
        ? { ...res, rules: res.rules.filter((r) => r.kind !== "friend") }
        : res;
    },
    async solve(rules) {
      if (id === "slow") await wait(6000);
      if (id === "solve-error") {
        await wait(700);
        throw fail("The solver could not finish (scenario: solve-error).");
      }
      const plan = await base.solve(rules);
      return id === "outside-hours" ? withEdgeSections(plan) : plan;
    },
    async adjust(planId, text, history) {
      if (id === "slow") await wait(6000);
      // Any text the mock does not recognise comes back as changed: false.
      const plan = await base.adjust(
        planId,
        id === "adjust-unchanged" ? "something the solver cannot do" : text,
        history,
      );
      return id === "outside-hours" ? withEdgeSections(plan) : plan;
    },
    async confirm(planId) {
      if (id === "slow") await wait(6000);
      if (id === "confirm-timeout") {
        await wait(4000);
        throw new ApiError("The request timed out", undefined, "timeout");
      }
      return base.confirm(planId);
    },
  };
}
