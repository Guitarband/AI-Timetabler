/**
 * Mock implementation of the Enrolment API.
 *
 * Purpose: run the full 9-phase flow with no backend, and stay as the demo-day fallback
 * (NEXT_PUBLIC_USE_MOCK=true). It must stay permanently (brief section 2).
 *
 * It uses the 8-section catalogue from the prototype design as sample data.
 * The regex parsing and scoring below exist ONLY to stand in for the backend.
 * Do NOT move any of it into the real implementation: rule parsing and solving belong to the backend.
 */
import type { EnrolmentApi } from "./api";
import type { Course } from "./courses";
import type { ClassAlternatives } from "./enrolment-contract";
import { labelFor } from "./rules";
import { DAY_LONG, DAY_PLURAL, fmtMin, toMin } from "./time";
import type {
  Confirmation,
  Context,
  FriendMatch,
  Message,
  ParseResponse,
  Plan,
  Rule,
  RuleScore,
  RuleStatus,
  Section,
} from "./types";

// ---------------------------------------------------------------------------
// Fixture data (prototype catalogue)
// ---------------------------------------------------------------------------

const CONTEXT: Context = {
  student_name: "",
  term: "Fall 2026",
  approved_courses: 5,
  published_sections: 41,
  friends: ["Maya Okafor"],
  greeting: {
    steps: [],
    text: "Tell me how you'd like your week to look — times, days off, or whose timetable to match.",
  },
};

type Fixture = Omit<Section, "with_friend" | "changed">;

const S: Record<string, Fixture> = {
  psycL02: {
    key: "psyc-l02",
    code: "PSYC 1010",
    title: "Introduction to Psychology",
    kind: "Lecture",
    section: "L-02",
    day: 1,
    start: "10:00",
    end: "11:30",
    room: "Hale Hall 204",
    credits: 3,
  },
  psycT05: {
    key: "psyc-t05",
    code: "PSYC 1010",
    title: "Introduction to Psychology",
    kind: "Tutorial",
    section: "T-05",
    day: 3,
    start: "10:00",
    end: "11:00",
    room: "Kerr 105",
    credits: 3,
  },
  statL01: {
    key: "stat-l01",
    code: "STAT 2010",
    title: "Statistics for Behavioural Science",
    kind: "Lecture",
    section: "L-01",
    day: 2,
    start: "11:00",
    end: "12:30",
    room: "Maud Building 1",
    credits: 3,
  },
  statB04: {
    key: "stat-b04",
    code: "STAT 2010",
    title: "Statistics for Behavioural Science",
    kind: "Lab",
    section: "B-04",
    day: 2,
    start: "14:00",
    end: "15:30",
    room: "Computing Lab B",
    credits: 3,
  },
  biolW02: {
    key: "biol-w02",
    code: "BIOL 1020",
    title: "Cells and Organisms",
    kind: "Lab",
    section: "W-02",
    day: 1,
    start: "13:00",
    end: "14:30",
    room: "Wet Lab 3",
    credits: 3,
  },
  biolL03: {
    key: "biol-l03",
    code: "BIOL 1020",
    title: "Cells and Organisms",
    kind: "Lecture",
    section: "L-03",
    day: 4,
    start: "10:30",
    end: "12:00",
    room: "Science Theatre 2",
    credits: 3,
  },
  writW01: {
    key: "writ-w01",
    code: "WRIT 1000",
    title: "Academic Writing",
    kind: "Workshop",
    section: "W-01",
    day: 3,
    start: "15:00",
    end: "16:30",
    room: "Studio 2",
    credits: 3,
  },
  writW03: {
    key: "writ-w03",
    code: "WRIT 1000",
    title: "Academic Writing",
    kind: "Workshop",
    section: "W-03",
    day: 3,
    start: "11:30",
    end: "13:00",
    room: "Studio 4",
    credits: 3,
  },
  philS02: {
    key: "phil-s02",
    code: "PHIL 1100",
    title: "Introduction to Philosophy",
    kind: "Seminar",
    section: "S-02",
    day: 4,
    start: "13:00",
    end: "14:30",
    room: "Kerr 210",
    credits: 3,
  },
  philS01: {
    key: "phil-s01",
    code: "PHIL 1100",
    title: "Introduction to Philosophy",
    kind: "Seminar",
    section: "S-01",
    day: 5,
    start: "09:00",
    end: "10:30",
    room: "Kerr 210",
    credits: 3,
  },
};

/** The first draft the "solver" returns. */
const DRAFT_V1 = [
  "psycL02",
  "psycT05",
  "statL01",
  "statB04",
  "biolW02",
  "biolL03",
  "writW01",
  "philS02",
];

/** Maya Okafor's published classes (keys into S). */
const FRIEND_TIMETABLES: Record<string, string[]> = {
  "maya okafor": ["psycL02", "statL01", "philS01"],
};

const HOLD_MINUTES = 20;
const REFERENCE = "ENR-2026F-48113";
const SWAP_DEADLINE = "2026-10-20";

// ---------------------------------------------------------------------------
// Mock session state (lives in memory, lost on refresh, which the brief accepts for the PoC)
// ---------------------------------------------------------------------------

interface Snapshot {
  ids: string[];
  rules: Rule[];
}

const session = {
  version: 0,
  kept: [] as string[],
  history: [] as Snapshot[],
};

// Restore the selected database snapshot before running demo adjustments/bookings.
export function restoreMockPlan(plan: Plan | null) {
  session.kept = [...(plan?.kept_sections ?? [])];
  session.version = plan?.version ?? 0;
  session.history = plan
    ? [
        {
          ids: plan.sections
            .map((section) =>
              Object.keys(S).find((id) => S[id].key === section.key),
            )
            .filter((id): id is string => !!id),
          rules: structuredClone(plan.rules),
        },
      ]
    : [];
}

const courseMetadata: Record<string, [string, string]> = {
  "PSYC 1010": [
    "Medicine, Nursing and Health Sciences",
    "Explore human behaviour, cognition and the foundations of psychological research through lectures and tutorials.",
  ],
  "STAT 2010": [
    "Science",
    "Develop statistical reasoning for behavioural research, with lectures and practical data analysis labs.",
  ],
  "BIOL 1020": [
    "Science",
    "Study cells and living organisms through lectures and laboratory work.",
  ],
  "WRIT 1000": [
    "Arts",
    "Practise academic argument, evidence and clear writing in workshops.",
  ],
  "PHIL 1100": [
    "Arts",
    "Examine foundational philosophical questions and practise critical reasoning in seminars.",
  ],
};

export const mockCourses: Course[] = [
  ...new Set(Object.values(S).map((s) => s.code)),
].map((code) => {
  const options = Object.values(S).filter((s) => s.code === code);
  return {
    code,
    title: options[0].title,
    credits: options[0].credits,
    faculty: courseMetadata[code][0],
    description: courseMetadata[code][1],
    available: true,
    timings: options.map((s) => ({
      id: s.key,
      kind: s.kind,
      label: s.section,
      day: s.day,
      startMinute: toMin(s.start),
      endMinute: toMin(s.end),
      room: s.room,
      enabled: true,
    })),
  };
});
let selectedCourses: string[] | null = null;
export function setMockCourses(codes: string[]) {
  selectedCourses = [...codes];
}
const selectedIds = (ids: string[]) =>
  ids.filter((id) => !selectedCourses || selectedCourses.includes(S[id]?.code));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => wait(600 + Math.round(Math.random() * 300));

// ---------------------------------------------------------------------------
// Parse (stand-in for the backend LLM)
// ---------------------------------------------------------------------------

const DAY_WORDS = ["monday", "tuesday", "wednesday", "thursday", "friday"];

function parseHour(
  h: string,
  m: string | undefined,
  ampm: string | undefined,
  preferPm: boolean,
): number {
  let hour = Number(h);
  if (ampm?.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (!ampm && preferPm && hour < 8) hour += 12; // "after 4" means 16:00
  return hour * 60 + (m ? Number(m) : 0);
}

let ruleSeq = 0;
function makeRule(
  kind: Rule["kind"],
  value: number | string,
  source: string,
  label?: string,
): Rule {
  ruleSeq += 1;
  return {
    id: `r${ruleSeq}`,
    kind,
    value,
    label: label ?? labelFor(kind as Parameters<typeof labelFor>[0], value),
    source,
  };
}

function detect(clause: string): Rule | null {
  const c = clause.trim();
  let m = c.match(/before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (m) {
    return makeRule("earliest", parseHour(m[1], m[2], m[3], false), c);
  }
  m = c.match(/after\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (m) {
    return makeRule("latest", parseHour(m[1], m[2], m[3], true), c);
  }
  const dayRe = new RegExp(`(${DAY_WORDS.join("|")})s?`, "i");
  m = c.match(dayRe);
  if (/\b(off|free|clear)\b|no classes on/i.test(c) && m) {
    return makeRule("dayoff", DAY_WORDS.indexOf(m[1].toLowerCase()) + 1, c);
  }
  if (/back[\s-]to[\s-]back\s+labs?/i.test(c)) {
    return makeRule("nolabs", 1, c);
  }
  if (/lunch/i.test(c)) {
    const mins = c.match(/(\d{2,3})\s*-?\s*min/i);
    return makeRule("lunch", mins ? Number(mins[1]) : 45, c);
  }
  const known = CONTEXT.friends.find(
    (f) =>
      c.toLowerCase().includes(f.toLowerCase()) ||
      c.toLowerCase().includes(f.split(" ")[0].toLowerCase()),
  );
  if (known && /match|with|same|as/i.test(c)) {
    return makeRule("friend", known, c);
  }
  m = c.match(
    /(?:match|with|same as)\s+(?:my timetable with\s+)?([A-Z][a-z]+\s+[A-Z][a-z]+)/,
  );
  if (m) {
    return makeRule("friend", m[1], c);
  }
  return null;
}

function parseText(text: string): ParseResponse {
  if (
    /^(?:fill in my timetable to allocate all my units with no clashes|build my timetable|allocate all my units|create a clash-free timetable)[.!?]?$/i.test(
      text.trim(),
    )
  ) {
    return {
      rules: [],
      ready_to_build: true,
      message: {
        steps: [],
        text: "I'll include every required class from your selected courses and avoid clashes. Choose ‘Build my timetable’; extra preferences are optional.",
      },
    };
  }
  const clauses = text
    .split(/,|;|\.\s|\band\b|\n/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const rules: Rule[] = [];
  const skipped: string[] = [];
  for (const c of clauses) {
    const r = detect(c);
    if (r && !rules.some((x) => x.kind === r.kind)) rules.push(r);
    else if (!r) skipped.push(c);
  }

  const steps = [
    "Reading what you wrote",
    `Matched ${rules.length} ${rules.length === 1 ? "phrase" : "phrases"} to rules I can check`,
  ];
  for (const s of skipped.slice(0, 2))
    steps.push(`Left out “${s}” — not something I can check`);

  const message: Message =
    rules.length > 0
      ? {
          steps,
          text: "Here's what I understood. Edit anything that's off — I won't plan until you say it looks right.",
        }
      : {
          steps,
          text: "I couldn't turn that into a rule I can check, so I won't guess. Try something like “no classes before 10”, or add a rule below.",
        };
  return { rules, message };
}

// ---------------------------------------------------------------------------
// Scoring (stand-in for the backend solver)
// ---------------------------------------------------------------------------

const SCORE: Record<RuleStatus, number> = { met: 100, partial: 70, unmet: 0 };

function friendKeys(rules: Rule[]): { name: string; keys: string[] } | null {
  const r = rules.find((x) => x.kind === "friend");
  if (!r) return null;
  const name = String(r.value).trim();
  return { name, keys: FRIEND_TIMETABLES[name.toLowerCase()] ?? [] };
}

function scoreRule(
  rule: Rule,
  sections: Section[],
  ids: string[],
  rules: Rule[],
): RuleScore {
  const base = { rule_id: rule.id, label: rule.label };
  const sorted = [...sections].sort((a, b) => toMin(a.start) - toMin(b.start));
  switch (rule.kind) {
    case "earliest": {
      const early = sorted.filter((s) => toMin(s.start) < Number(rule.value));
      if (early.length === 0) {
        const first = sorted[0];
        return {
          ...base,
          status: "met",
          note: first
            ? `Earliest class starts ${first.start} (${DAY_LONG[first.day - 1]})`
            : "",
        };
      }
      return {
        ...base,
        status: "unmet",
        note: `${early[0].code} starts ${early[0].start} on ${DAY_LONG[early[0].day - 1]}`,
      };
    }
    case "latest": {
      const late = sections.filter((s) => toMin(s.end) > Number(rule.value));
      const last = [...sections].sort((a, b) => toMin(b.end) - toMin(a.end))[0];
      if (late.length === 0)
        return {
          ...base,
          status: "met",
          note: last
            ? `Last class ends ${last.end} (${DAY_LONG[last.day - 1]})`
            : "",
        };
      return {
        ...base,
        status: "unmet",
        note: `${late[0].code} ends ${late[0].end} on ${DAY_LONG[late[0].day - 1]}`,
      };
    }
    case "latest_day": {
      const [day, min] = String(rule.value).split("@").map(Number);
      const late = sections.filter((s) => s.day === day && toMin(s.end) > min);
      if (late.length === 0)
        return {
          ...base,
          status: "met",
          note: `${DAY_PLURAL[day - 1]} finish by ${fmtMin(min)}`,
        };
      return {
        ...base,
        status: "unmet",
        note: `${late[0].code} ends ${late[0].end}`,
      };
    }
    case "dayoff": {
      const d = Number(rule.value);
      const on = sections.filter((s) => s.day === d);
      if (on.length === 0)
        return {
          ...base,
          status: "met",
          note: `No classes on ${DAY_LONG[d - 1]}`,
        };
      return {
        ...base,
        status: "unmet",
        note: `${on[0].code} ${on[0].kind.toLowerCase()} is on ${DAY_LONG[d - 1]}`,
      };
    }
    case "nolabs": {
      const labs = sections.filter((s) => s.kind === "Lab");
      const clash = labs.find((a) =>
        labs.some(
          (b) =>
            a !== b &&
            a.day === b.day &&
            Math.abs(toMin(a.end) - toMin(b.start)) <= 15,
        ),
      );
      return clash
        ? {
            ...base,
            status: "unmet",
            note: `Two labs run back to back on ${DAY_LONG[clash.day - 1]}`,
          }
        : { ...base, status: "met", note: "No two labs run back to back" };
    }
    case "lunch": {
      const need = Number(rule.value) || 45;
      const days = [1, 2, 3, 4, 5].filter((d) =>
        sections.some((s) => s.day === d),
      );
      const ok = days.filter((d) => {
        const busy = sections
          .filter((s) => s.day === d)
          .map((s) => [toMin(s.start), toMin(s.end)]);
        for (let t = 11 * 60 + 30; t + need <= 14 * 60; t += 15) {
          if (!busy.some(([a, b]) => a < t + need && b > t)) return true;
        }
        return false;
      });
      const status: RuleStatus =
        ok.length === days.length ? "met" : ok.length > 0 ? "partial" : "unmet";
      return {
        ...base,
        status,
        note: `${ok.length} of ${days.length} days have a ${need}-minute gap between 11:30 and 14:00`,
      };
    }
    case "friend": {
      const f = friendKeys(rules);
      if (!f || f.keys.length === 0)
        return {
          ...base,
          status: "unmet",
          note: `I couldn't find ${f?.name || "that friend"}'s published timetable`,
        };
      const shared = f.keys.filter((k) => ids.includes(k)).length;
      const status: RuleStatus =
        shared === f.keys.length ? "met" : shared > 0 ? "partial" : "unmet";
      return {
        ...base,
        status,
        note: `${shared} of ${f.name.split(" ")[0]}'s ${f.keys.length} classes shared`,
      };
    }
    default:
      return { ...base, status: "met", note: "" };
  }
}

function friendMatch(ids: string[], rules: Rule[]): FriendMatch | undefined {
  const f = friendKeys(rules);
  if (!f) return undefined;
  if (f.keys.length === 0) {
    return {
      name: f.name,
      shared: 0,
      total: 0,
      text: `I couldn't find ${f.name}'s published timetable, so nothing is matched yet.`,
    };
  }
  const sharedKeys = f.keys.filter((k) => ids.includes(k));
  const missing = f.keys.filter((k) => !ids.includes(k));
  const list = sharedKeys
    .map((k) => `${S[k].code} ${S[k].kind.toLowerCase()}`)
    .join(", ");
  if (missing.length === 0) {
    return {
      name: f.name,
      shared: sharedKeys.length,
      total: f.keys.length,
      text: `Friend match fully applied — all ${f.keys.length} of ${f.name}'s classes are shared (${list}).`,
    };
  }
  const m = S[missing[0]];
  return {
    name: f.name,
    shared: sharedKeys.length,
    total: f.keys.length,
    text: `Friend match partly applied — ${sharedKeys.length} of ${f.name}'s ${f.keys.length} classes are shared (${list}). Their ${m.code} ${m.kind.toLowerCase()} only runs ${DAY_LONG[m.day - 1]} ${m.start}, which clashes with two of your rules.`,
  };
}

function buildPlan(
  ids: string[],
  rules: Rule[],
  prevIds: string[] | null,
  message: Message,
  changed = true,
): Plan {
  ids = selectedIds(ids);
  const f = friendKeys(rules);
  const sections: Section[] = ids.map((id) => ({
    ...S[id],
    with_friend: !!f && f.keys.includes(id),
    changed: prevIds ? !prevIds.includes(id) : false,
  }));
  const scores = rules.map((r) => scoreRule(r, sections, ids, rules));
  const match_pct = scores.length
    ? Math.floor(
        scores.reduce((a, s) => a + SCORE[s.status], 0) / scores.length,
      )
    : 100;
  const courses = new Map<string, number>();
  for (const s of sections)
    courses.set(s.code, Math.max(courses.get(s.code) ?? 0, s.credits));
  return {
    plan_id: `mock-plan-${session.version}`,
    version: session.version,
    changed,
    rules,
    sections,
    kept_sections: [...session.kept],
    match_pct,
    scores,
    friend: friendMatch(ids, rules),
    summary: {
      sections: sections.length,
      credits: [...courses.values()].reduce((a, b) => a + b, 0),
      hold_minutes: HOLD_MINUTES,
    },
    message,
    source_sections: CONTEXT.published_sections,
  };
}

const current = () => session.history[session.history.length - 1];

function editable(planId: string) {
  const snap = current();
  if (!snap || planId !== `mock-plan-${session.version}`)
    throw new Error("Reopen the latest timetable before changing it.");
  return snap;
}

function pinBlock(ids: string[]) {
  const moved = session.kept.filter(
    (key) => !ids.some((id) => S[id].key === key),
  );
  return moved.length
    ? `These classes are kept and cannot move: ${moved
        .map((key) => {
          const s = Object.values(S).find((s) => s.key === key);
          return s ? `${s.code} ${s.section}` : key;
        })
        .join(
          ", ",
        )}. Open the class and turn off “Keep this class” to move it. Your timetable is unchanged.`
    : null;
}

function mockAlternatives(planId: string, key: string): ClassAlternatives {
  const snap = editable(planId);
  const source = snap.ids.find((id) => S[id].key === key);
  if (!source) throw new Error("Choose a class in the current timetable.");
  const plan = buildPlan(snap.ids, snap.rules, null, {
    steps: [],
    text: "Current timetable.",
  });
  const section = plan.sections.find((s) => s.key === key);
  if (!section) throw new Error("Choose a class in the current timetable.");
  return {
    plan_id: planId,
    current: section,
    kept: session.kept.includes(key),
    options: Object.entries(S)
      .filter(
        ([id, s]) =>
          id !== source && s.code === section.code && s.kind === section.kind,
      )
      .map(([id, target]) => {
        const reasons: string[] = [];
        const ids = snap.ids.map((old) => (old === source ? id : old));
        const pin = pinBlock(ids);
        if (pin) reasons.push(pin);
        for (const other of plan.sections) {
          if (
            other.key !== key &&
            other.day === target.day &&
            other.start < target.end &&
            target.start < other.end
          )
            reasons.push(
              `Clashes with ${other.code} ${other.kind} ${other.section} on ${DAY_LONG[other.day - 1]} ${other.start}–${other.end}.`,
            );
        }
        const candidate = buildPlan(ids, snap.rules, null, {
          steps: [],
          text: "Alternative.",
        });
        return {
          section: { ...target, with_friend: false, changed: false },
          remaining_seats: null,
          can_swap: reasons.length === 0,
          reasons,
          preference_notes: candidate.scores
            .filter((s, i) => SCORE[s.status] < SCORE[plan.scores[i].status])
            .map((s) => `Less of this preference is met: ${s.label}.`),
        };
      })
      .sort(
        (a, b) =>
          a.section.day - b.section.day ||
          a.section.start.localeCompare(b.section.start),
      ),
  };
}

// ---------------------------------------------------------------------------
// The mock API
// ---------------------------------------------------------------------------

export const mockApi: EnrolmentApi = {
  async alternatives(planId, key) {
    return mockAlternatives(planId, key);
  },
  async keep(planId, key, keep) {
    const snap = editable(planId);
    if (!snap.ids.some((id) => S[id].key === key))
      throw new Error("Choose a current class.");
    session.kept = keep
      ? [...new Set([...session.kept, key])]
      : session.kept.filter((k) => k !== key);
    session.version += 1;
    session.history.push(structuredClone(snap));
    return buildPlan(snap.ids, snap.rules, null, {
      steps: [],
      text: keep
        ? "This class is kept. Adjustments will leave it in place."
        : "This class can move during adjustments again.",
    });
  },
  async swap(planId, from, to) {
    const snap = editable(planId);
    const option = mockAlternatives(planId, from).options.find(
      (o) => o.section.key === to,
    );
    if (!option) throw new Error("Choose an alternative for this class.");
    if (!option.can_swap)
      return buildPlan(
        snap.ids,
        snap.rules,
        null,
        {
          steps: option.reasons,
          text: "That swap cannot be made. Your timetable is unchanged.",
        },
        false,
      );
    const target = Object.keys(S).find((id) => S[id].key === to);
    if (!target) throw new Error("That class is no longer published.");
    const ids = snap.ids.map((id) => (S[id].key === from ? target : id));
    session.version += 1;
    session.history.push({ ids, rules: snap.rules });
    return buildPlan(ids, snap.rules, snap.ids, {
      steps: [],
      text: `Swapped to ${option.section.code} ${option.section.section}. All other classes stayed in place.`,
      note: option.preference_notes.join(" ") || undefined,
    });
  },
  async getContext() {
    await wait(250);
    session.version = 0;
    session.kept = [];
    session.history = [];
    const context = structuredClone(CONTEXT);
    if (selectedCourses) {
      context.approved_courses = selectedCourses.length;
      context.published_sections = mockCourses
        .filter((course) => selectedCourses?.includes(course.code))
        .reduce((count, course) => count + course.timings.length, 0);
    }
    return context;
  },

  async parse(text) {
    await latency();
    return parseText(text);
  },

  async solve(rules) {
    await latency();
    session.version = 1;
    session.kept = [];
    const ids = selectedIds(DRAFT_V1);
    session.history = [{ ids, rules: structuredClone(rules) }];
    const courses = new Set(ids.map((k) => S[k].code)).size;
    const dayoff = rules.find((r) => r.kind === "dayoff");
    const f = friendKeys(rules);
    const missing = f ? f.keys.filter((k) => !ids.includes(k)) : [];

    const message: Message = {
      steps: [
        `Reading your ${rules.length} ${rules.length === 1 ? "rule" : "rules"}`,
        `Pulling the ${CONTEXT.published_sections} published ${CONTEXT.term} sections`,
        "Testing every combination for clashes",
        "Scoring each draft against your rules",
      ],
      text: `Built a timetable from ${ids.length} sections across your ${courses} approved courses${dayoff ? `, with ${DAY_PLURAL[Number(dayoff.value) - 1]} kept clear` : ""}.`,
      note:
        f && missing.length > 0 && f.keys.length > 0
          ? `One trade-off, plainly: ${f.name}'s ${S[missing[0]].code} ${S[missing[0]].kind.toLowerCase()} only runs ${DAY_LONG[S[missing[0]].day - 1]} ${S[missing[0]].start}, which would break two of your rules. I kept your rules and matched the other ${f.keys.length - missing.length} classes instead. Say “put me in that seminar” and I'll flip it and show you the cost.`
          : undefined,
    };
    return buildPlan(ids, structuredClone(rules), null, message);
  },

  async adjust(planId, text) {
    await latency();
    const snap = editable(planId);
    const t = text.toLowerCase();
    const unchanged = (msg: Message) =>
      buildPlan(snap.ids, snap.rules, null, msg, false);

    // 1) Undo
    if (/\bundo\b|put it back|revert|go back/.test(t)) {
      if (session.history.length < 2) {
        return unchanged({
          steps: ["Re-reading your request"],
          text: "There's nothing to undo yet — this is still your first draft.",
        });
      }
      const prev = session.history[session.history.length - 2];
      const blocked = pinBlock(prev.ids);
      if (blocked) return unchanged({ steps: [], text: blocked });
      session.version += 1;
      session.history.push({
        ids: [...prev.ids],
        rules: structuredClone(prev.rules),
      });
      return buildPlan(prev.ids, prev.rules, snap.ids, {
        steps: [
          "Re-reading your request",
          "Restoring your previous draft",
          "Re-testing every clash and your other rules",
        ],
        text: "Undone — you're back to the previous draft.",
      });
    }

    // 2) Swap the seminar to the friend's section
    if (/seminar|phil/.test(t)) {
      if (!snap.ids.some((id) => S[id].code === "PHIL 1100"))
        return unchanged({
          steps: [],
          text: "PHIL 1100 is not in your selected courses. Choose it in course onboarding before planning its seminar.",
          action: "course_onboarding",
        });
      if (snap.ids.includes("philS01")) {
        return unchanged({
          steps: ["Re-reading your request"],
          text: "You're already in that seminar, so nothing moved.",
        });
      }
      const ids = snap.ids.map((k) => (k === "philS02" ? "philS01" : k));
      const blocked = pinBlock(ids);
      if (blocked) return unchanged({ steps: [], text: blocked });
      session.version += 1;
      session.history.push({ ids, rules: snap.rules });
      const f = friendKeys(snap.rules);
      const first = f?.name.split(" ")[0] ?? "your friend";
      return buildPlan(ids, snap.rules, snap.ids, {
        steps: [
          "Re-reading your request",
          `Pulling ${first}'s PHIL 1100 seminar`,
          "S-01 runs Friday 09:00 – 10:30",
          "Re-testing every clash and your other rules",
        ],
        text: `Moved PHIL 1100 Introduction to Philosophy from Thursday 13:00 to Friday 09:00 — section S-01, Kerr 210, with ${first}.`,
        note: "The cost: Fridays are no longer free, and Friday starts at 09:00. Say “undo” to put it back.",
      });
    }

    // 3) Move the Wednesday workshop earlier
    if (/wed/.test(t) && /workshop|writ|earlier/.test(t)) {
      if (!snap.ids.some((id) => S[id].code === "WRIT 1000"))
        return unchanged({
          steps: [],
          text: "WRIT 1000 is not in your selected courses. Choose it in course onboarding before planning its workshop.",
          action: "course_onboarding",
        });
      if (!snap.ids.includes("writW01")) {
        return unchanged({
          steps: [
            "Re-reading your request",
            "Pulling the other 3 published WRIT 1000 workshops",
          ],
          text: "Your Wednesday workshop is already at 11:30 — the earliest one that doesn't clash.",
        });
      }
      const ids = snap.ids.map((k) => (k === "writW01" ? "writW03" : k));
      const blocked = pinBlock(ids);
      if (blocked) return unchanged({ steps: [], text: blocked });
      const rules = [...snap.rules];
      let note: string | undefined;
      const workAt = t.match(
        /(?:start work|work)\s*(?:at)?\s*(\d{1,2})(?::(\d{2}))?/,
      );
      if (workAt) {
        const min = Number(workAt[1]) * 60 + Number(workAt[2] ?? 0);
        const label = `Nothing after ${fmtMin(min)} on Wednesdays`;
        rules.push(
          makeRule("latest_day", `3@${min}`, "from your request", label),
        );
        note = `I've added “${label.charAt(0).toLowerCase() + label.slice(1)}” to your rules so I hold that line from here on.`;
      }
      session.version += 1;
      session.history.push({ ids, rules });
      return buildPlan(ids, rules, snap.ids, {
        steps: [
          "Re-reading your request",
          "Pulling the other 3 published WRIT 1000 workshops",
          "W-03 Wed 11:30 has 4 seats left",
          "Re-testing every clash and your other rules",
        ],
        text: "Moved WRIT 1000 Academic Writing from Wednesday 15:00 to Wednesday 11:30 — section W-03, Studio 4, 4 seats left. Nothing else had to move.",
        note,
      });
    }

    // 4) Anything else: cannot do it, nothing changes (version and timetable stay as they are)
    void planId;
    return unchanged({
      steps: ["Re-reading your request", "Checking the published sections"],
      text: "I can't do that one with the sections that are published without breaking another of your rules, so your timetable is unchanged.",
    });
  },

  async confirm(planId) {
    await latency();
    void planId;
    const snap = current();
    const sections = snap ? selectedIds(snap.ids).map((k) => S[k]) : [];
    const courses = new Map<string, number>();
    for (const s of sections)
      courses.set(s.code, Math.max(courses.get(s.code) ?? 0, s.credits));
    const credits = [...courses.values()].reduce((a, b) => a + b, 0);
    const res: Confirmation = {
      reference: REFERENCE,
      confirmed_at: new Date().toISOString(),
      courses: courses.size,
      sections: sections.length,
      credits,
      swap_deadline: SWAP_DEADLINE,
      message: {
        steps: [
          `Reserving your ${sections.length} sections`,
          "Confirming seats one last time",
          "Writing to your enrolment record",
          "Emailing your timetable and adding it to your calendar",
        ],
        text: `You're enrolled — ${courses.size} courses, ${sections.length} sections, ${credits} credits.\nReference ${REFERENCE}`,
      },
    };
    return res;
  },
};
