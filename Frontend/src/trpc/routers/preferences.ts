import { z } from "zod";
import { authenticatedProcedure, createTRPCRouter } from "../init";

const weekday = z.enum([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

const preferenceInput = z
  .object({
    earliestStartMinute: z.number().int().min(0).max(1439),
    latestEndMinute: z.number().int().min(1).max(1440),
    preferredDays: z.array(weekday).max(7),
    avoidedDays: z.array(weekday).max(7),
    maxCampusDays: z.number().int().min(1).max(7).nullable(),
    prioritizeFriends: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.earliestStartMinute >= value.latestEndMinute) {
      ctx.addIssue({
        code: "custom",
        path: ["latestEndMinute"],
        message: "End time must be after start time.",
      });
    }

    const preferred = new Set(value.preferredDays);
    if (preferred.size !== value.preferredDays.length) {
      ctx.addIssue({
        code: "custom",
        path: ["preferredDays"],
        message: "Choose each preferred day once.",
      });
    }
    if (new Set(value.avoidedDays).size !== value.avoidedDays.length) {
      ctx.addIssue({
        code: "custom",
        path: ["avoidedDays"],
        message: "Choose each avoided day once.",
      });
    }
    if (value.avoidedDays.some((day) => preferred.has(day))) {
      ctx.addIssue({
        code: "custom",
        path: ["avoidedDays"],
        message: "A day cannot be preferred and avoided.",
      });
    }
  });

const defaultPreferences = {
  earliestStartMinute: 540,
  latestEndMinute: 1080,
  preferredDays: [],
  avoidedDays: [],
  maxCampusDays: null,
  prioritizeFriends: true,
  updatedAt: null,
} as const;

const preferenceFields = {
  earliestStartMinute: true,
  latestEndMinute: true,
  preferredDays: true,
  avoidedDays: true,
  maxCampusDays: true,
  prioritizeFriends: true,
  updatedAt: true,
} as const;

export const preferencesRouter = createTRPCRouter({
  get: authenticatedProcedure.query(async ({ ctx }) => {
    return (
      (await ctx.prisma.timetablePreference.findUnique({
        where: { userId: ctx.user.id },
        select: preferenceFields,
      })) ?? defaultPreferences
    );
  }),
  save: authenticatedProcedure
    .input(preferenceInput)
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.timetablePreference.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id, ...input },
        update: input,
        select: preferenceFields,
      });
    }),
});
