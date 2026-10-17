import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { mockCourses } from "@/lib/api.mock";
import { type Course, type CourseCatalogue, sameCourses } from "@/lib/courses";
import type { Prisma } from "../../../generated/prisma/client";
import { authenticatedProcedure, createTRPCRouter } from "../init";

const scopeFor = (userId: string) => ({
  userId,
  mode:
    (process.env.NEXT_PUBLIC_USE_MOCK ?? "true") !== "false" ? "mock" : "real",
  termId: process.env.TERM_ID || "2026-fall",
});
const accountProcedure = authenticatedProcedure
  .input(z.object({ accountId: z.string().min(1) }))
  .use(({ ctx, input, next }) => {
    if (input.accountId !== ctx.user.id)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Your signed-in account changed. Reload the page.",
      });
    return next();
  });

export async function readCourseCatalogue(
  db: Prisma.TransactionClient,
  userId: string,
): Promise<CourseCatalogue> {
  const scope = scopeFor(userId);
  const onboarding = await db.courseOnboarding.findUnique({
    where: { userId_mode_termId: scope },
  });
  let courses: Course[];
  let term = "Fall 2026";
  if (scope.mode === "mock") courses = mockCourses;
  else {
    const currentTerm = await db.academicTerm.findUnique({
      where: { id: scope.termId },
    });
    if (!currentTerm)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "The course catalogue for this term is not available yet.",
      });
    term = currentTerm.name;
    const rows = await db.course.findMany({
      where: { classes: { some: { termId: scope.termId } } },
      include: {
        classes: {
          where: { termId: scope.termId },
          include: { options: true },
        },
      },
      orderBy: { code: "asc" },
    });
    courses = rows.map((row) => ({
      code: row.code,
      title: row.title,
      credits: row.credits,
      faculty: row.faculty,
      description: row.description,
      available:
        row.classes.length > 0 &&
        row.classes.every((group) =>
          group.options.some((option) => option.enabled),
        ),
      timings: row.classes.flatMap((group) =>
        group.options.map((option) => ({
          id: option.id,
          kind: group.kind,
          label: option.label,
          day: option.day,
          startMinute: option.startMinute,
          endMinute: option.endMinute,
          room: option.room,
          enabled: option.enabled,
        })),
      ),
    }));
  }
  const selected = onboarding?.courseCodes ?? [];
  return {
    termId: scope.termId,
    term,
    demo: scope.mode === "mock",
    courses,
    selected,
    completed:
      selected.length > 0 &&
      selected.every((code) =>
        courses.some((course) => course.code === code && course.available),
      ),
  };
}

export const coursesRouter = createTRPCRouter({
  catalogue: accountProcedure.query(({ ctx }) =>
    readCourseCatalogue(ctx.prisma, ctx.user.id),
  ),
  save: accountProcedure
    .input(
      z.object({
        termId: z.string().min(1),
        codes: z.array(z.string().min(1).max(100)).min(1).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = scopeFor(ctx.user.id);
      if (scope.termId !== input.termId)
        throw new TRPCError({
          code: "CONFLICT",
          message: "The active term changed. Reload the course catalogue.",
        });
      return ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${ctx.user.id} FOR UPDATE`;
        const catalogue = await readCourseCatalogue(tx, ctx.user.id);
        const codes = [...new Set(input.codes)].sort();
        if (
          codes.length !== input.codes.length ||
          codes.some(
            (code) =>
              !catalogue.courses.some(
                (course) => course.code === code && course.available,
              ),
          )
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Choose courses with published classes from the current catalogue.",
          });
        const changed = !sameCourses(codes, catalogue.selected);
        if (scope.mode === "real") {
          const enrolled = await tx.classEnrolment.findMany({
            where: {
              userId: ctx.user.id,
              courseClass: { termId: scope.termId },
            },
            include: { courseClass: true },
          });
          if (
            enrolled.some(
              (entry) => !codes.includes(entry.courseClass.courseCode),
            )
          )
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "A course with confirmed enrolments cannot be removed here. Keep it selected until its enrolment is withdrawn.",
            });
          // In this prototype these records are the planner's course list, not an institutional approval.
          await tx.courseApproval.deleteMany({
            where: {
              userId: ctx.user.id,
              termId: scope.termId,
              courseCode: { notIn: codes },
            },
          });
          await tx.courseApproval.createMany({
            data: codes.map((courseCode) => ({
              userId: ctx.user.id,
              termId: scope.termId,
              courseCode,
            })),
            skipDuplicates: true,
          });
        }
        await tx.courseOnboarding.upsert({
          where: { userId_mode_termId: scope },
          create: { ...scope, courseCodes: codes },
          update: { courseCodes: codes },
        });
        if (changed)
          await tx.timetableLibrary.updateMany({
            where: { userId: ctx.user.id, mode: scope.mode },
            data: { activeId: null },
          });
        return { saved: true, changed };
      });
    }),
});
