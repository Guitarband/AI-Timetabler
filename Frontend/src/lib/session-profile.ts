import type { Context } from "./types";

/** Identity comes from the authenticated session, even when the planner uses fixtures. */
export function personalizeContext(context: Context, name: string): Context {
  const firstName = name.trim().split(/\s+/)[0] || "there";
  return {
    ...context,
    student_name: name,
    greeting: {
      ...context.greeting,
      text: `Hi ${firstName}. Tell me how you'd like your week to look — times, days off, or whose timetable to match. I'll show you the rules I took from it before I plan anything.`,
    },
  };
}
