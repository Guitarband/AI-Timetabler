import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlannerSnapshot } from "../src/lib/saved-timetables";

test(
  "PostgreSQL round trip, ownership, revisions and plan recovery (all fixture rows rolled back)",
  {
    skip: process.env.RUN_SAVED_TIMETABLE_POSTGRES_TESTS !== "1",
  },
  async () => {
    const { config } = await import("dotenv");
    config({ quiet: true });
    process.env.NEXT_PUBLIC_USE_MOCK = "false";
    const { PrismaClient } = await import("../generated/prisma/client");
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { appRouter } = await import("../src/trpc/routers/_app");
    const db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    const id = `persistence-test-${crypto.randomUUID()}`;
    const otherId = `${id}-other`;
    const familyId = `${id}-family`;
    const planId = `${id}-v1`;
    const headId = `${id}-v2`;
    const termId = `${id}-term`;
    const rollback = new Error("Intentional fixture rollback");
    const snapshot: PlannerSnapshot = {
      version: 1,
      phase: "adjust",
      draft: "Keep this unsent question",
      rules: [],
      confirmation: null,
      context: {
        student_name: "Persistence Test",
        term: "Test term",
        approved_courses: 1,
        published_sections: 1,
        friends: [],
        greeting: { text: "Hello", steps: [] },
      },
      items: [
        { id: crypto.randomUUID(), role: "user", text: "Plan my classes" },
        {
          id: crypto.randomUUID(),
          role: "ai",
          animate: false,
          message: {
            text: "Here is your timetable",
            steps: ["Checked classes"],
          },
        },
      ],
      plan: {
        plan_id: planId,
        version: 1,
        changed: true,
        rules: [],
        sections: [
          {
            key: "test-section",
            code: "FIT1001",
            title: "Test course",
            kind: "Lecture",
            section: "L1",
            day: 1,
            start: "10:00",
            end: "11:00",
            room: "Test room",
            credits: 6,
            with_friend: false,
            changed: false,
          },
        ],
        match_pct: 100,
        scores: [],
        summary: { sections: 1, credits: 6, hold_minutes: 0 },
        message: { text: "Here is your timetable", steps: [] },
      },
    };
    try {
      await assert.rejects(
        db.$transaction(
          async (tx) => {
            for (const userId of [id, otherId])
              await tx.user.create({
                data: {
                  id: userId,
                  name: "Persistence Test",
                  email: `${userId}@student.monash.edu`,
                  emailVerified: true,
                },
              });
            const caller = (userId = id) =>
              appRouter.createCaller({
                // Route transactions share this enclosing rollback-only test transaction.
                prisma: {
                  $transaction: (
                    run: (client: typeof tx) => Promise<unknown>,
                  ) => run(tx),
                },
                session: {
                  user: {
                    id: userId,
                    name: "Persistence Test",
                    email: `${userId}@student.monash.edu`,
                    emailVerified: true,
                  },
                },
                requestHeaders: new Headers(),
                responseHeaders: new Headers(),
                canSetCookies: true,
                requestUrl: "http://localhost:3000/api/trpc",
              } as unknown as Parameters<typeof appRouter.createCaller>[0])
                .savedTimetables;
            const value = {
              accountId: id,
              id: crypto.randomUUID(),
              name: "Database test",
              revision: 0,
              mutationId: crypto.randomUUID(),
              snapshot,
            };
            const created = await caller().save(value);
            assert.equal(created.revision, 1);
            assert.equal((await caller().save(value)).revision, 1);
            const reopened = await caller().open({
              accountId: id,
              id: value.id,
            });
            assert.deepEqual(reopened.snapshot, snapshot);
            assert.equal(
              (await caller().list({ accountId: id })).activeId,
              value.id,
            );
            await assert.rejects(
              () => caller(otherId).open({ accountId: otherId, id: value.id }),
              { code: "NOT_FOUND" },
            );
            await caller().save({
              ...value,
              revision: 1,
              mutationId: crypto.randomUUID(),
              name: "Renamed in database",
            });
            await assert.rejects(
              () =>
                caller().save({
                  ...value,
                  revision: 1,
                  mutationId: crypto.randomUUID(),
                }),
              { code: "CONFLICT" },
            );
            assert.equal(
              (await caller().open({ accountId: id, id: value.id })).name,
              "Renamed in database",
            );
            const imported = {
              id: crypto.randomUUID(),
              name: "Imported",
              snapshot,
            };
            const legacy = {
              accountId: id,
              activeId: imported.id,
              entries: [imported],
            };
            assert.equal((await caller().importLegacy(legacy)).imported, 1);
            assert.equal((await caller().importLegacy(legacy)).imported, 0);
            assert.equal(
              (await caller().list({ accountId: id })).activeId,
              value.id,
            );
            await tx.academicTerm.create({
              data: { id: termId, name: "Test term" },
            });
            const confirmation = {
              reference: "test-confirmation",
              confirmed_at: new Date().toISOString(),
              courses: 1,
              sections: 1,
              credits: 6,
              swap_deadline: "2026-10-30",
              message: { text: "Confirmed", steps: [] },
            };
            await tx.planFamily.create({
              data: {
                id: familyId,
                ownerId: id,
                termId,
                head: headId,
                confirmation,
              },
            });
            await tx.plannerPlan.create({
              data: {
                id: planId,
                familyId,
                body: JSON.parse(JSON.stringify(snapshot.plan)),
              },
            });
            await tx.plannerPlan.create({
              data: {
                id: headId,
                familyId,
                parentId: planId,
                body: JSON.parse(
                  JSON.stringify({
                    ...snapshot.plan,
                    plan_id: headId,
                    version: 2,
                    message: { text: "Recovered adjustment", steps: [] },
                  }),
                ),
              },
            });
            const recovered = await caller().open({
              accountId: id,
              id: value.id,
            });
            assert.equal(recovered.snapshot.plan?.plan_id, headId);
            assert.equal(
              recovered.snapshot.confirmation?.reference,
              confirmation.reference,
            );
            assert.equal(
              recovered.snapshot.items.length,
              snapshot.items.length + 2,
            );
            assert.equal(recovered.revision, 3);
            assert.equal(
              (await caller().open({ accountId: id, id: value.id })).revision,
              3,
            );
            const removed = await caller().remove({
              accountId: id,
              id: value.id,
              revision: 3,
            });
            const deletedLibrary = await caller().list({ accountId: id });
            assert.equal(deletedLibrary.activeId, null);
            assert.ok(
              !deletedLibrary.entries.some((entry) => entry.id === value.id),
            );
            await assert.rejects(
              () =>
                caller().save({
                  ...value,
                  revision: 3,
                  mutationId: crypto.randomUUID(),
                }),
              { code: "CONFLICT" },
            );
            const restored = await caller().restore({
              accountId: id,
              ...removed,
            });
            assert.deepEqual(restored.snapshot, recovered.snapshot);
            assert.deepEqual(
              (
                await tx.planFamily.findUniqueOrThrow({
                  where: { id: familyId },
                })
              ).confirmation,
              confirmation,
            );
            throw rollback;
          },
          { timeout: 90000, maxWait: 20000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await db.user.findUnique({ where: { id } }), null);
    } finally {
      await db.$disconnect();
    }
  },
);
