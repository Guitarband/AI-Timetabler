import type { AssistantSpeed } from "./types";

/**
 * Runtime config, read from NEXT_PUBLIC_* env vars (see Frontend/.env.example).
 * NEXT_PUBLIC_ vars are inlined at build time, so a change needs a rebuild/redeploy.
 */

const speedRaw = (
  process.env.NEXT_PUBLIC_ASSISTANT_SPEED ?? "normal"
).toLowerCase();

export const config = {
  /** true = mock implementation, no backend needed. Defaults to true so demo day never depends on the backend. */
  useMock: (process.env.NEXT_PUBLIC_USE_MOCK ?? "true") !== "false",
  assistantSpeed: (["cinematic", "normal", "instant"].includes(speedRaw)
    ? speedRaw
    : "normal") as AssistantSpeed,
  showThoughtLog: process.env.NEXT_PUBLIC_SHOW_THOUGHT_LOG !== "false",
  showMatchBadge: process.env.NEXT_PUBLIC_SHOW_MATCH_BADGE !== "false",
  /** Request timeout for the real API, in ms. */
  requestTimeoutMs: 30_000,
};

/** Pacing multipliers (brief section 7): Normal x1, Cinematic x1.6, Instant x0.12. */
const SPEED_MULT: Record<AssistantSpeed, number> = {
  cinematic: 1.6,
  normal: 1,
  instant: 0.12,
};

/** Thought log pacing at Normal speed, in ms. */
export const PACING = {
  beforeFirstStep: 260,
  perStep: 430,
  beforeText: 320,
  /** timetable -> adjust happens automatically after this delay. */
  timetableToAdjust: 900,
  /** match badge count-up */
  countUp: 700,
};

export function speedMult(
  speed: AssistantSpeed = config.assistantSpeed,
): number {
  return SPEED_MULT[speed];
}

/** Total time a message takes to fully reveal (steps, then text). Used to sequence phase changes. */
export function revealDuration(
  stepCount: number,
  speed: AssistantSpeed = config.assistantSpeed,
): number {
  const steps = config.showThoughtLog ? stepCount : 0;
  const base =
    steps > 0
      ? PACING.beforeFirstStep + steps * PACING.perStep + PACING.beforeText
      : PACING.beforeText;
  return Math.round(base * speedMult(speed));
}
