/**
 * Static UI copy (English only, taken from the prototype).
 * Anything that depends on data (names, counts, dates) is a function of that data.
 * AI message text is NOT here: it always comes from the API response (or the mock).
 */

export const COPY = {
  portal: {
    university: "Monash University",
    portal: "Student Portal",
    // Display only. These links do not go anywhere in this PoC (brief section 2).
    nav: ["Home", "Courses", "Enrolment", "Timetable", "Fees"],
    active: "Enrolment",
  },
  title: "Enrolment Assistant",
  addonTag: "AI add-on · beta",
  steps: ["Preferences", "Confirm", "Timetable", "Adjust", "Enrol"],
  assistant: "Assistant",
  status: {
    listening: "listening",
    working: "working…",
    complete: "enrolment complete",
  },
  working: "working",
  composer: {
    intake: {
      placeholder: (friend?: string) =>
        `e.g. No classes before 10, keep Fridays free, and match my timetable with ${friend ?? "a friend"}.`,
      hint: "Enter to send · Shift+Enter for a new line",
      button: "Send",
    },
    adjust: {
      placeholder:
        "e.g. Move my Wednesday workshop earlier — I start work at 15:00.",
      hint: "Ask about your timetable or request a change",
      button: "Send request",
    },
    busy: {
      placeholder: "One moment…",
      hint: "Working through your request…",
      button: "Send request",
    },
    locked: (deadline: string) =>
      `Enrolment locked in. Section swaps stay open until ${deadline}.`,
  },
  // Quick chips. Intake chips append to the textarea; adjust chips send straight away.
  chips: {
    intake: (friend?: string) => [
      "No classes before 10",
      "Keep Fridays free",
      friend
        ? `Match my timetable with ${friend}`
        : "Match my timetable with a friend",
      "No back-to-back labs",
    ],
    adjust: (friend?: string) => [
      friend
        ? `Which classes match with ${friend.split(" ")[0]}?`
        : "What classes do I have on Wednesday?",
      "Move my Wednesday workshop earlier — I start work at 15:00",
      friend
        ? `Put me in ${friend.split(" ")[0]}'s seminar`
        : "Put me in my friend's seminar",
      "Undo the last change",
    ],
  },
  chipMaxChars: 44,
  rulesCard: {
    title: "What I understood",
    count: (n: number) =>
      `${n} ${n === 1 ? "rule" : "rules"} · edit before I plan`,
    empty: "Nothing captured yet",
    addRule: "Add a rule",
    build: "Looks right — build my timetable",
    remove: "Remove rule",
    friendName: "Student name or student ID",
  },
  afterBuild:
    "Would you like any adjustments? Tell me what to change — a day, a time, a section, or whose timetable to match — and I'll show you what moves.",
  afterAdjust: "Anything else you'd like moved, or shall we lock it in?",
  loadErrorText:
    "I couldn't load your enrolment details, so I can't plan yet. Refresh the page to try again.",
  errorText:
    "Something went wrong on my side, so nothing has changed. Your message is back in the box — send it again when you're ready.",
  timetable: {
    titleEmpty: "Weekly timetable",
    titleDraft: "Proposed timetable",
    titleFinal: (term: string) => `Your ${term} timetable`,
    tagEmpty: "no draft yet",
    tagDraft: (v: number) => `draft v${v}`,
    tagFinal: "final",
    enrolled: "Enrolled",
    descEmpty: (n: number, term: string) =>
      `I'll build it from the ${n} sections your faculty has already published for ${term}.`,
    desc: (n: number, term: string) =>
      `Assembled from the ${n} sections your faculty has already published for ${term} — no new sections invented.`,
    placeholder: "Your week appears here",
    keptClear: "Kept clear",
    matchLabel: "Preference match",
  },
  legend: {
    yours: "Your section",
    shared: (first: string) => `Shared with ${first}`,
    changed: "Changed by your last request",
  },
  block: {
    withFriend: (first: string) => `◦ With ${first}`,
    justChanged: "Just changed",
  },
  friendStrip: {
    tag: (shared: number, total: number) => `${shared} of ${total} shared`,
  },
  audit: {
    scored: "How your rules scored",
    courses: "Courses in this plan",
    status: { met: "Met", partial: "Partly met", unmet: "Traded off" } as const,
    credits: (n: number) => `${n} cr`,
  },
  confirmBar: {
    summary: (sections: number, credits: number, hold: number) =>
      `${sections} sections · ${credits} credits · ${hold > 0 ? `seats held for ${hold} minutes while you decide` : "seats checked when you confirm"}`,
    ask: "Ask for a change",
    confirm: "Confirm enrolment",
  },
  confirmed: {
    title: "Enrolment confirmed",
    reference: "Reference",
    courses: "Courses",
    sections: "Sections",
    credits: "Credits",
    calendar: "Add to calendar",
    download: "Download timetable",
  },
};

export function truncateChip(label: string, max = COPY.chipMaxChars): string {
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label;
}
