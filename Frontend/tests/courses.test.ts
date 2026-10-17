import assert from "node:assert/strict";
import { before, test } from "node:test";
import {
  mockApi,
  mockCourses,
  restoreMockPlan,
  setMockCourses,
} from "../src/lib/api.mock";
import {
  courseOnboardingMessage,
  filterCourses,
  layoutTimings,
  sameCourses,
} from "../src/lib/courses";
import { initialState, reducer } from "../src/lib/reducer";
import { snapshotSchema } from "../src/lib/saved-timetables";

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5432/security_test";
process.env.BETTER_AUTH_SECRET = "a-test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.NEXT_PUBLIC_USE_MOCK = "true";
let router: typeof import("../src/trpc/routers/_app").appRouter;
before(async () => {
  ({ appRouter: router } = await import("../src/trpc/routers/_app"));
});

test("course search, faculty and selected filters compose without changing the source", () => {
  assert.deepEqual(
    filterCourses(mockCourses, "  writing ", "Arts", "all", [], "code").map(
      (c) => c.code,
    ),
    ["WRIT 1000"],
  );
  assert.deepEqual(
    filterCourses(
      mockCourses,
      "",
      "Science",
      "selected",
      ["BIOL 1020", "PHIL 1100"],
      "title",
    ).map((c) => c.code),
    ["BIOL 1020"],
  );
  const sorted = filterCourses(mockCourses, "", "", "all", [], "title");
  assert.equal(sorted[0].title, "Academic Writing");
  assert.equal(mockCourses.length, 5);
  assert.ok(sameCourses(["A", "B"], ["B", "A"]));
  assert.ok(!sameCourses(["A", "B"], ["A", "C"]));
});

test("preview keeps overlapping alternatives in separate lanes, including weekends and touching boundaries", () => {
  const base = mockCourses[0].timings[0];
  const timings = [
    { ...base, id: "a", day: 1, startMinute: 540, endMinute: 600 },
    { ...base, id: "b", day: 1, startMinute: 570, endMinute: 630 },
    { ...base, id: "c", day: 1, startMinute: 600, endMinute: 660 },
    { ...base, id: "d", day: 1, startMinute: 660, endMinute: 720 },
    { ...base, id: "weekend", day: 7, startMinute: 1200, endMinute: 1290 },
  ];
  const laidOut = layoutTimings(timings);
  assert.equal(laidOut.length, timings.length);
  assert.deepEqual(
    laidOut.map((t) => [t.id, t.lane, t.lanes]),
    [
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
      ["d", 0, 1],
      ["weekend", 0, 1],
    ],
  );
});

test("onboarding text and button survive saving and restoring the conversation", () => {
  let state = reducer(initialState, {
    type: "CONTEXT_LOADED",
    context: {
      student_name: "Test",
      term: "Fall",
      approved_courses: 0,
      published_sections: 0,
      friends: [],
      greeting: courseOnboardingMessage,
    },
  });
  state = reducer(state, { type: "USER_SAID", text: "Keep Friday free" });
  state = reducer(state, { type: "AI_SAID", message: courseOnboardingMessage });
  const snapshot = snapshotSchema.parse({ ...state, version: 1 });
  const restored = reducer(initialState, { type: "OPEN_TIMETABLE", snapshot });
  const message = restored.items.at(-1);
  assert.equal(
    message?.role === "ai" && message.message.action,
    "course_onboarding",
  );
  assert.equal(restored.phase, "intake");
  assert.equal(restored.plan, null);
});

function fixture() {
  const rows = new Map<string, { courseCodes: string[] }>();
  const approvals: string[] = [];
  let libraryResets = 0;
  const tx = {
    $queryRaw: async () => [],
    courseOnboarding: {
      findUnique: async ({
        where,
      }: {
        where: { userId_mode_termId: { userId: string } };
      }) => rows.get(where.userId_mode_termId.userId) ?? null,
      upsert: async ({
        create,
      }: {
        create: { userId: string; courseCodes: string[] };
      }) => {
        rows.set(create.userId, { courseCodes: create.courseCodes });
      },
    },
    timetableLibrary: {
      updateMany: async () => {
        libraryResets += 1;
      },
    },
    academicTerm: { findUnique: async () => ({ name: "Test term" }) },
    course: {
      findMany: async () =>
        mockCourses.map((course) => ({
          ...course,
          classes: [{ kind: "Lecture", options: course.timings }],
        })),
    },
    classEnrolment: {
      findMany: async () => [] as { courseClass: { courseCode: string } }[],
    },
    courseApproval: {
      deleteMany: async () => {
        approvals.length = 0;
      },
      createMany: async ({ data }: { data: { courseCode: string }[] }) => {
        approvals.push(...data.map((row) => row.courseCode));
      },
    },
  };
  const caller = (userId = "student-a", signedIn = true) =>
    router.createCaller({
      prisma: {
        ...tx,
        $transaction: (run: (client: typeof tx) => unknown) => run(tx),
      },
      session: signedIn
        ? {
            user: {
              id: userId,
              name: "Test",
              email: "test@student.monash.edu",
              emailVerified: true,
            },
          }
        : null,
      requestHeaders: new Headers(),
      responseHeaders: new Headers(),
      requestUrl: "http://localhost:3000/api/trpc",
      canSetCookies: true,
    } as unknown as Parameters<typeof router.createCaller>[0]);
  return {
    caller,
    tx,
    rows,
    approvals,
    get libraryResets() {
      return libraryResets;
    },
  };
}

test("onboarding persists for the session owner; repeat saves preserve the active timetable", async () => {
  const db = fixture();
  const api = db.caller().courses;
  assert.equal(
    (await api.catalogue({ accountId: "student-a" })).completed,
    false,
  );
  await api.save({
    accountId: "student-a",
    termId: "2026-fall",
    codes: ["BIOL 1020"],
  });
  assert.equal(
    (await api.catalogue({ accountId: "student-a" })).completed,
    true,
  );
  assert.deepEqual((await api.catalogue({ accountId: "student-a" })).selected, [
    "BIOL 1020",
  ]);
  assert.equal(
    (await db.caller("student-b").courses.catalogue({ accountId: "student-b" }))
      .completed,
    false,
  );
  await api.save({
    accountId: "student-a",
    termId: "2026-fall",
    codes: ["BIOL 1020"],
  });
  assert.equal(db.libraryResets, 1);
});

test("onboarding rejects stale accounts, invalid courses, duplicates, empty selections and changed terms", async () => {
  const db = fixture();
  await assert.rejects(
    () =>
      db
        .caller("student-a", false)
        .courses.catalogue({ accountId: "student-a" }),
    { code: "UNAUTHORIZED" },
  );
  await assert.rejects(
    () =>
      db.caller().courses.save({
        accountId: "student-b",
        termId: "2026-fall",
        codes: ["BIOL 1020"],
      }),
    { code: "UNAUTHORIZED" },
  );
  for (const codes of [[], ["NOT A COURSE"], ["BIOL 1020", "BIOL 1020"]])
    await assert.rejects(
      () =>
        db
          .caller()
          .courses.save({ accountId: "student-a", termId: "2026-fall", codes }),
      { code: "BAD_REQUEST" },
    );
  await assert.rejects(
    () =>
      db.caller().courses.save({
        accountId: "student-a",
        termId: "old-term",
        codes: ["BIOL 1020"],
      }),
    { code: "CONFLICT" },
  );
  assert.equal(db.rows.size, 0);
});

test("real selections reach the solver's course list and cannot remove confirmed courses", async () => {
  process.env.NEXT_PUBLIC_USE_MOCK = "false";
  try {
    const db = fixture();
    await db.caller().courses.save({
      accountId: "student-a",
      termId: "2026-fall",
      codes: ["BIOL 1020", "WRIT 1000"],
    });
    assert.deepEqual(db.approvals, ["BIOL 1020", "WRIT 1000"]);
    db.tx.classEnrolment.findMany = async () => [
      { courseClass: { courseCode: "BIOL 1020" } },
    ];
    await assert.rejects(
      () =>
        db.caller().courses.save({
          accountId: "student-a",
          termId: "2026-fall",
          codes: ["WRIT 1000"],
        }),
      { code: "CONFLICT" },
    );
    assert.deepEqual(db.approvals, ["BIOL 1020", "WRIT 1000"]);
  } finally {
    process.env.NEXT_PUBLIC_USE_MOCK = "true";
  }
});

test("mock build, reopened draft and confirmation use only selected courses", async () => {
  setMockCourses(["BIOL 1020"]);
  const context = await mockApi.getContext();
  assert.equal(context.approved_courses, 1);
  const plan = await mockApi.solve([
    {
      id: "dayoff",
      kind: "dayoff",
      value: 5,
      label: "Friday free",
      source: "Friday free",
    },
  ]);
  assert.deepEqual(
    [...new Set(plan.sections.map((section) => section.code))],
    ["BIOL 1020"],
  );
  restoreMockPlan(plan);
  const unchanged = await mockApi.adjust(
    plan.plan_id,
    "Move the philosophy seminar",
  );
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.message.action, "course_onboarding");
  const confirmation = await mockApi.confirm(plan.plan_id);
  assert.equal(confirmation.courses, 1);
  assert.equal(confirmation.sections, 2);
  setMockCourses(mockCourses.map((course) => course.code));
});
