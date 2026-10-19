import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { config } from "@/lib/config";
import {
  importTimetablesInput,
  saveTimetableInput,
  snapshotSchema,
} from "@/lib/saved-timetables";
import type {
  Prisma,
  SavedTimetable as SavedRow,
} from "../../../generated/prisma/client";
import { authenticatedProcedure, createTRPCRouter } from "../init";

const mode = () => (config.useMock ? "mock" : "real");
// Reject queued requests from a page belonging to a previous signed-in account.
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
const summarySelect = {
  id: true,
  name: true,
  term: true,
  planVersion: true,
  confirmed: true,
  revision: true,
  updatedAt: true,
  snapshot: true,
} as const;
const isDeleted = (snapshot: unknown) =>
  z.object({ deleted: z.literal(true) }).safeParse(snapshot).success;
function serialize(row: SavedRow) {
  return {
    id: row.id,
    name: row.name,
    term: row.term,
    planVersion: row.planVersion,
    confirmed: row.confirmed,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
    snapshot: snapshotSchema.parse(row.snapshot),
  };
}

// Serialize writes for one owner, including creation and active-workspace selection.
// Revisions still reject a stale browser; retries with the same mutation ID are safe.
async function lockOwner(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;
}
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message:
      "This timetable changed in another tab or device. Save a copy to keep your changes.",
  });

export const savedTimetablesRouter = createTRPCRouter({
  list: accountProcedure.query(async ({ ctx }) => {
    const scope = { userId: ctx.user.id, mode: mode() };
    return ctx.prisma.$transaction(async (tx) => {
      const library = await tx.timetableLibrary.findUnique({
        where: { userId_mode: scope },
      });
      const entries = await tx.savedTimetable.findMany({
        where: scope,
        select: summarySelect,
        orderBy: { updatedAt: "desc" },
      });
      const visible = entries.filter((entry) => !isDeleted(entry.snapshot));
      return {
        activeId: visible.some((entry) => entry.id === library?.activeId)
          ? (library?.activeId ?? null)
          : null,
        entries: visible.map(({ snapshot: _snapshot, ...entry }) => ({
          ...entry,
          updatedAt: entry.updatedAt.toISOString(),
        })),
      };
    });
  }),

  open: accountProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const scope = { userId: ctx.user.id, mode: mode() };
      return ctx.prisma.$transaction(async (tx) => {
        await lockOwner(tx, ctx.user.id);
        const where = { userId_mode_id: { ...scope, id: input.id } };
        let row = await tx.savedTimetable.findUnique({ where });
        if (!row || isDeleted(row.snapshot))
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Saved timetable not found.",
          });
        const snapshot = snapshotSchema.parse(row.snapshot);
        if (scope.mode === "real" && snapshot.plan) {
          // A solver/booking request may commit just before the browser closes.
          // Reconcile against the authoritative PostgreSQL plan family on reopen.
          const original = await tx.plannerPlan.findFirst({
            where: {
              id: snapshot.plan.plan_id,
              family: { ownerId: ctx.user.id },
            },
            include: { family: true },
          });
          if (
            original &&
            (original.family.head !== snapshot.plan.plan_id ||
              (original.family.confirmation && !snapshot.confirmation))
          ) {
            const head = await tx.plannerPlan.findFirst({
              where: { id: original.family.head, familyId: original.familyId },
            });
            if (head) {
              const recovered = snapshotSchema.parse({
                ...snapshot,
                plan: head.body,
                confirmation: original.family.confirmation,
              });
              if (!recovered.plan)
                throw new TRPCError({
                  code: "INTERNAL_SERVER_ERROR",
                  message: "The saved plan could not be restored.",
                });
              recovered.rules = recovered.plan.rules;
              recovered.phase = recovered.confirmation ? "confirmed" : "adjust";
              if (original.family.head !== snapshot.plan.plan_id)
                recovered.items.push({
                  id: crypto.randomUUID(),
                  role: "ai",
                  animate: false,
                  message: recovered.plan.message,
                });
              if (recovered.confirmation && !snapshot.confirmation)
                recovered.items.push({
                  id: crypto.randomUUID(),
                  role: "ai",
                  animate: false,
                  message: recovered.confirmation.message,
                });
              row = await tx.savedTimetable.update({
                where,
                data: {
                  snapshot: JSON.parse(
                    JSON.stringify(snapshotSchema.parse(recovered)),
                  ) as Prisma.InputJsonValue,
                  planVersion: recovered.plan.version,
                  confirmed: !!recovered.confirmation,
                  revision: { increment: 1 },
                  mutationId: crypto.randomUUID(),
                },
              });
            }
          }
        }
        await tx.timetableLibrary.upsert({
          where: { userId_mode: scope },
          create: { ...scope, activeId: row.id },
          update: { activeId: row.id },
        });
        return serialize(row);
      });
    }),

  save: accountProcedure
    .input(saveTimetableInput)
    .mutation(async ({ ctx, input }) => {
      const scope = { userId: ctx.user.id, mode: mode() };
      const where = { userId_mode_id: { ...scope, id: input.id } };
      return ctx.prisma.$transaction(async (tx) => {
        await lockOwner(tx, ctx.user.id);
        const current = await tx.savedTimetable.findUnique({ where });
        if (current && isDeleted(current.snapshot))
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This timetable was deleted. Save a copy to keep your changes.",
          });
        if (current?.mutationId === input.mutationId) return serialize(current);
        if ((current?.revision ?? 0) !== input.revision) throw conflict();
        const data = {
          name: input.name,
          term: input.snapshot.context.term,
          planVersion: input.snapshot.plan?.version ?? null,
          confirmed: !!input.snapshot.confirmation,
          snapshot: JSON.parse(
            JSON.stringify(input.snapshot),
          ) as Prisma.InputJsonValue,
          mutationId: input.mutationId,
        };
        const row = current
          ? await tx.savedTimetable.update({
              where,
              data: { ...data, revision: { increment: 1 } },
            })
          : await tx.savedTimetable.create({
              data: { ...scope, id: input.id, ...data },
            });
        await tx.timetableLibrary.upsert({
          where: { userId_mode: scope },
          create: { ...scope, activeId: row.id },
          update: { activeId: row.id },
        });
        return serialize(row);
      });
    }),

  remove: accountProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        revision: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = { userId: ctx.user.id, mode: mode() };
      return ctx.prisma.$transaction(async (tx) => {
        await lockOwner(tx, ctx.user.id);
        const where = { userId_mode_id: { ...scope, id: input.id } };
        const row = await tx.savedTimetable.findUnique({ where });
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Saved timetable not found.",
          });
        if (isDeleted(row.snapshot))
          return { id: row.id, revision: row.revision };
        if (row.revision !== input.revision) throw conflict();
        const removed = await tx.savedTimetable.update({
          where,
          data: {
            snapshot: {
              ...snapshotSchema.parse(row.snapshot),
              deleted: true,
            } as unknown as Prisma.InputJsonValue,
            revision: { increment: 1 },
            mutationId: crypto.randomUUID(),
          },
        });
        const library = await tx.timetableLibrary.findUnique({
          where: { userId_mode: scope },
        });
        if (library?.activeId === input.id)
          await tx.timetableLibrary.upsert({
            where: { userId_mode: scope },
            create: { ...scope, activeId: null },
            update: { activeId: null },
          });
        return { id: removed.id, revision: removed.revision };
      });
    }),

  restore: accountProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        revision: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = { userId: ctx.user.id, mode: mode() };
      return ctx.prisma.$transaction(async (tx) => {
        await lockOwner(tx, ctx.user.id);
        const where = { userId_mode_id: { ...scope, id: input.id } };
        const row = await tx.savedTimetable.findUnique({ where });
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Saved timetable not found.",
          });
        if (!isDeleted(row.snapshot)) return serialize(row);
        if (row.revision !== input.revision) throw conflict();
        return serialize(
          await tx.savedTimetable.update({
            where,
            data: {
              snapshot: JSON.parse(
                JSON.stringify(snapshotSchema.parse(row.snapshot)),
              ) as Prisma.InputJsonValue,
              revision: { increment: 1 },
              mutationId: crypto.randomUUID(),
            },
          }),
        );
      });
    }),

  importLegacy: accountProcedure
    .input(importTimetablesInput)
    .mutation(async ({ ctx, input }) => {
      const scope = { userId: ctx.user.id, mode: mode() };
      return ctx.prisma.$transaction(async (tx) => {
        await lockOwner(tx, ctx.user.id);
        const result = await tx.savedTimetable.createMany({
          skipDuplicates: true,
          data: input.entries.map((entry) => ({
            ...scope,
            id: entry.id,
            name: entry.name,
            term: entry.snapshot.context.term,
            planVersion: entry.snapshot.plan?.version ?? null,
            confirmed: !!entry.snapshot.confirmation,
            snapshot: JSON.parse(
              JSON.stringify(entry.snapshot),
            ) as Prisma.InputJsonValue,
            mutationId: crypto.randomUUID(),
          })),
        });
        const importedActive = input.activeId
          ? await tx.savedTimetable.findUnique({
              where: { userId_mode_id: { ...scope, id: input.activeId } },
            })
          : null;
        const activeId =
          input.activeId &&
          importedActive &&
          !isDeleted(importedActive.snapshot)
            ? input.activeId
            : null;
        // Importing again never overwrites a newer database snapshot or selection.
        if (activeId)
          await tx.timetableLibrary.upsert({
            where: { userId_mode: scope },
            create: { ...scope, activeId },
            update: {},
          });
        return { imported: result.count };
      });
    }),
});
