import { z } from "zod";
import { config } from "./config";
import type { State } from "./reducer";
import type { Confirmation, Context, Plan } from "./types";

const message = z.object({
  text: z.string(),
  steps: z.array(z.string()),
  note: z.string().optional(),
  action: z.enum(["course_onboarding", "new_timetable"]).optional(),
  rule_change: z
    .object({
      plan_id: z.string(),
      token: z.string(),
      remove: z.array(
        z.object({
          id: z.string(),
          kind: z.string(),
          value: z.union([z.number(), z.string()]),
          label: z.string(),
          source: z.string(),
        }),
      ),
      add: z.array(
        z.object({
          id: z.string(),
          kind: z.string(),
          value: z.union([z.number(), z.string()]),
          label: z.string(),
          source: z.string(),
        }),
      ),
      reasons: z.array(z.string()),
      status: z.enum(["applied", "declined", "unavailable"]).optional(),
    })
    .optional(),
});
const friend = z.object({
  name: z.string(),
  shared: z.number(),
  total: z.number(),
  text: z.string(),
});
const plan: z.ZodType<Plan> = z.object({
  plan_id: z.string().min(1),
  version: z.number().int().positive(),
  changed: z.boolean(),
  kept_sections: z.array(z.string()).optional(),
  rules: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      value: z.union([z.number(), z.string()]),
      label: z.string(),
      source: z.string(),
    }),
  ),
  sections: z
    .array(
      z.object({
        key: z.string(),
        code: z.string(),
        title: z.string(),
        kind: z.string(),
        section: z.string(),
        day: z.union([
          z.literal(1),
          z.literal(2),
          z.literal(3),
          z.literal(4),
          z.literal(5),
        ]),
        start: z.string(),
        end: z.string(),
        room: z.string(),
        credits: z.number(),
        with_friend: z.boolean(),
        shared_with: z.array(z.string()).optional(),
        changed: z.boolean(),
      }),
    )
    .min(1),
  match_pct: z.number().min(0).max(100),
  scores: z.array(
    z.object({
      rule_id: z.string(),
      label: z.string(),
      status: z.enum(["met", "partial", "unmet"]),
      note: z.string(),
    }),
  ),
  friend: friend.optional(),
  friends: z.array(friend).optional(),
  summary: z.object({
    sections: z.number(),
    credits: z.number(),
    hold_minutes: z.number(),
  }),
  message,
  source_sections: z.number().optional(),
});
const context: z.ZodType<Context> = z.object({
  student_name: z.string(),
  term: z.string(),
  approved_courses: z.number(),
  published_sections: z.number(),
  friends: z.array(z.string()),
  greeting: message,
});
const confirmation: z.ZodType<Confirmation> = z.object({
  reference: z.string(),
  confirmed_at: z.string(),
  courses: z.number(),
  sections: z.number(),
  credits: z.number(),
  swap_deadline: z.string(),
  message,
});
const legacySaved = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  updatedAt: z.string(),
  plan,
  context,
  confirmation: confirmation.nullable(),
});
const legacyLibrary = z.object({
  version: z.literal(1),
  activeId: z.string().nullable(),
  entries: z.array(legacySaved),
});

const chatItem = z.discriminatedUnion("role", [
  z.object({
    id: z.string().min(1).max(200),
    role: z.literal("user"),
    text: z.string().max(10_000),
  }),
  z.object({
    id: z.string().min(1).max(200),
    role: z.literal("ai"),
    message,
    animate: z.boolean(),
    error: z.boolean().optional(),
  }),
  z.object({ id: z.string().min(1).max(200), role: z.literal("rules") }),
]);

export const snapshotSchema = z
  .object({
    version: z.literal(1),
    context,
    plan: plan.nullable(),
    confirmation: confirmation.nullable(),
    rules: z
      .array(
        z.object({
          id: z.string(),
          kind: z.string(),
          value: z.union([z.number(), z.string()]),
          label: z.string(),
          source: z.string(),
        }),
      )
      .max(100),
    items: z.array(chatItem).max(2000),
    phase: z.enum([
      "intake",
      "thinking",
      "confirm",
      "generating",
      "timetable",
      "adjust",
      "adjusting",
      "confirming",
      "confirmed",
    ]),
    draft: z.string().max(10_000),
  })
  .superRefine((value, ctx) => {
    if (JSON.stringify(value).length > 2_000_000)
      ctx.addIssue({
        code: "custom",
        message:
          "This conversation is too large to save. Start a new timetable.",
      });
    if (value.confirmation && !value.plan)
      ctx.addIssue({
        code: "custom",
        message: "A confirmation requires a timetable.",
      });
    if (new Set(value.items.map((item) => item.id)).size !== value.items.length)
      ctx.addIssue({
        code: "custom",
        message: "Conversation message IDs must be unique.",
      });
  });

export type PlannerSnapshot = z.infer<typeof snapshotSchema>;
export type TimetableSummary = {
  id: string;
  name: string;
  term: string;
  planVersion: number | null;
  confirmed: boolean;
  revision: number;
  updatedAt: string;
};
export type SavedTimetable = TimetableSummary & { snapshot: PlannerSnapshot };
export type TimetableLibrary = {
  activeId: string | null;
  entries: TimetableSummary[];
};

export const saveTimetableInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  revision: z.number().int().nonnegative(),
  mutationId: z.string().uuid(),
  snapshot: snapshotSchema,
});
export type SaveTimetableInput = z.infer<typeof saveTimetableInput>;
export const importTimetablesInput = z.object({
  activeId: z.string().uuid().nullable(),
  entries: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(80),
        snapshot: snapshotSchema,
      }),
    )
    .max(10),
});

export function snapshotOf(state: State): PlannerSnapshot | null {
  if (!state.context) return null;
  return {
    version: 1,
    context: state.context,
    plan: state.plan,
    confirmation: state.confirmation,
    rules: state.rules,
    phase: state.phase,
    draft: state.draft,
    items: state.items.map((item) =>
      item.role === "ai" ? { ...item, animate: false } : item,
    ),
  };
}

export function emptyLibrary(): TimetableLibrary {
  return { activeId: null, entries: [] };
}

// Read-only compatibility importer. All new writes go through the authenticated API.
export function readLegacyTimetables(userId: string) {
  const mode = config.useMock ? "mock" : "real";
  const raw = window.localStorage.getItem(
    `enrolment:saved-timetables:v1:${mode}:${userId}`,
  );
  if (!raw) return { activeId: null, entries: [] };
  const old = legacyLibrary.parse(JSON.parse(raw));
  return {
    activeId: old.activeId,
    entries: old.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      snapshot: snapshotSchema.parse({
        version: 1,
        context: entry.context,
        plan: entry.plan,
        confirmation: entry.confirmation,
        rules: entry.plan.rules,
        phase: entry.confirmation ? "confirmed" : "adjust",
        draft: "",
        items: [
          {
            id: crypto.randomUUID(),
            role: "ai",
            animate: false,
            message: {
              steps: [],
              text: "Imported your browser-saved timetable. Earlier chat messages were not stored by the old version.",
            },
          },
        ],
      }),
    })),
  };
}
