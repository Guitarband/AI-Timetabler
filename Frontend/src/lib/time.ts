import type { Section } from "./types";

/** Default visible window of the week grid: 09:00 to 18:00. */
export const GRID_START_MIN = 9 * 60; // 540
export const GRID_END_MIN = 18 * 60; // 1080
export const SLOT_MIN = 30;

export const DAY_SHORT = ["MON", "TUE", "WED", "THU", "FRI"] as const;
export const DAY_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
] as const;
export const DAY_PLURAL = [
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
] as const;

/** "10:30" -> 630 (minutes from midnight). */
export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** 630 -> "10:30" */
export function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 540 -> "9:00" (hour labels on the grid have no leading zero). */
export function fmtHourLabel(min: number): string {
  return `${Math.floor(min / 60)}:00`;
}

/**
 * Grid window. Starts at 09:00-18:00 and grows (to whole hours) so a section
 * outside that range is never cut off (brief section 9).
 */
export function gridRange(sections: Section[]): {
  startMin: number;
  endMin: number;
} {
  let startMin = GRID_START_MIN;
  let endMin = GRID_END_MIN;
  for (const s of sections) {
    startMin = Math.min(startMin, Math.floor(toMin(s.start) / 60) * 60);
    endMin = Math.max(endMin, Math.ceil(toMin(s.end) / 60) * 60);
  }
  return { startMin, endMin };
}

/**
 * CSS grid placement for a section (brief section 6).
 *   row  = (startMin - gridStart) / 30 + 2   (row 1 is the day header)
 *   span = (endMin - startMin) / 30
 *   col  = day + 1                            (col 1 is the time column)
 */
export function gridPlacement(s: Section, gridStartMin: number) {
  const startMin = toMin(s.start);
  const endMin = toMin(s.end);
  const row = Math.floor((startMin - gridStartMin) / SLOT_MIN) + 2;
  const span = Math.max(1, Math.ceil((endMin - startMin) / SLOT_MIN));
  const col = s.day + 1;
  return {
    gridRow: `${row} / span ${span}`,
    gridColumn: `${col}`,
    durationMin: endMin - startMin,
  };
}
