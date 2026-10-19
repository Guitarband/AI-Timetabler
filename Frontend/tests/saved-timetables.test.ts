import assert from "node:assert/strict";
import { before, test } from "node:test";
import { initialState, reducer } from "../src/lib/reducer";
import {
  type PlannerSnapshot,
  type SavedTimetable,
  type SaveTimetableInput,
  snapshotOf,
  snapshotSchema,
} from "../src/lib/saved-timetables";
import { type SaveStatus, TimetableWriter } from "../src/lib/timetable-writer";

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5432/persistence_test";
process.env.BETTER_AUTH_SECRET = "a-test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.NEXT_PUBLIC_USE_MOCK = "true";

type Router = typeof import("../src/trpc/routers/_app").appRouter;
let router: Router;
before(async () => {
  ({ appRouter: router } = await import("../src/trpc/routers/_app"));
});
const user = {
  id: "owner-a",
  name: "Student A",
  email: "a@student.monash.edu",
  emailVerified: true,
};
const context = {
  student_name: "Student A",
  term: "Semester 2",
  approved_courses: 1,
  published_sections: 2,
  friends: [],
  greeting: { text: "Let's plan your classes.", steps: [] },
};
function snapshot(): PlannerSnapshot {
  let state = reducer(initialState, {
    type: "NEW_TIMETABLE",
    context: structuredClone(context),
  });
  state = reducer(state, { type: "USER_SAID", text: "Keep Fridays free" });
  state = reducer(state, {
    type: "AI_SAID",
    message: { text: "Fridays are free.", steps: ["Read preferences"] },
  });
  state = reducer(state, {
    type: "RULES_PARSED",
    rules: [
      {
        id: "friday",
        kind: "dayoff",
        value: 5,
        label: "Friday off",
        source: "Keep Fridays free",
      },
    ],
  });
  state = reducer(state, { type: "SET_DRAFT", text: "Also start after 10" });
  return snapshotSchema.parse(JSON.parse(JSON.stringify(snapshotOf(state))));
}
function input(): SaveTimetableInput {
  return {
    id: crypto.randomUUID(),
    name: "My timetable",
    revision: 0,
    mutationId: crypto.randomUUID(),
    snapshot: snapshot(),
  };
}
function saved(value: SaveTimetableInput): SavedTimetable {
  return {
    id: value.id,
    name: value.name,
    term: value.snapshot.context.term,
    planVersion: value.snapshot.plan?.version ?? null,
    confirmed: !!value.snapshot.confirmation,
    revision: value.revision + 1,
    updatedAt: new Date().toISOString(),
    snapshot: structuredClone(value.snapshot),
  };
}

test("conversation-only drafts restore messages, edited rules and composer without replaying animation", () => {
  const original = snapshot();
  const reloaded = reducer(initialState, {
    type: "OPEN_TIMETABLE",
    snapshot: snapshotSchema.parse(JSON.parse(JSON.stringify(original))),
  });
  assert.equal(reloaded.phase, "confirm");
  assert.equal(reloaded.plan, null);
  assert.deepEqual(reloaded.items, original.items);
  assert.deepEqual(reloaded.rules, original.rules);
  assert.equal(reloaded.draft, "Also start after 10");
  assert.ok(
    reloaded.items.every((item) => item.role !== "ai" || !item.animate),
  );
  const continued = reducer(reloaded, {
    type: "USER_SAID",
    text: "Next message",
  });
  assert.equal(
    new Set(continued.items.map((item) => item.id)).size,
    continued.items.length,
  );
});

test("an interrupted request restores an editable phase and retains the submitted message", () => {
  const pending = { ...snapshot(), phase: "thinking" as const };
  const restored = reducer(initialState, {
    type: "OPEN_TIMETABLE",
    snapshot: pending,
  });
  assert.equal(restored.phase, "confirm");
  assert.equal(restored.items.length, pending.items.length + 1);
  assert.match(
    JSON.stringify(restored.items),
    /previous request was interrupted/,
  );
  assert.match(JSON.stringify(restored.items), /Keep Fridays free/);
});

test("snapshot validation rejects malformed, duplicate-message and oversized data", () => {
  assert.throws(() => snapshotSchema.parse({ ...snapshot(), plan: {} }));
  const duplicate = snapshot();
  duplicate.items.push(duplicate.items[0]);
  assert.throws(() => snapshotSchema.parse(duplicate));
  const huge = snapshot();
  huge.context.greeting.text = "x".repeat(2_000_001);
  assert.throws(() => snapshotSchema.parse(huge));
});

test("writer serializes overlapping saves and acknowledges the latest chat, not an older response", async () => {
  const writes: SaveTimetableInput[] = [];
  const acknowledgements: SavedTimetable[] = [];
  let release!: () => void;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = new TimetableWriter(
    async (value) => {
      writes.push(structuredClone(value));
      if (writes.length === 1) await first;
      return saved(value);
    },
    (entry) => acknowledgements.push(entry),
    () => {},
  );
  writer.update("First", snapshot());
  const flushing = writer.flush();
  const newer = { ...snapshot(), draft: "The newest message" };
  writer.update("Renamed", newer);
  assert.equal(writer.flush(), flushing);
  assert.equal(writes.length, 1);
  release();
  await flushing;
  assert.equal(writes.length, 2);
  assert.equal(writes[1].revision, 1);
  assert.equal(writes[1].id, writes[0].id);
  assert.equal(acknowledgements.at(-1)?.snapshot.draft, newer.draft);
  assert.equal(writer.dirty, false);
  assert.equal(writer.status, "saved");
});

test("a lost save response retries the same mutation before sending newer changes", async () => {
  const writes: SaveTimetableInput[] = [];
  let persisted: SavedTimetable | null = null;
  const statuses: SaveStatus[] = [];
  const writer = new TimetableWriter(
    async (value) => {
      writes.push(structuredClone(value));
      if (writes.length === 1) {
        persisted = saved(value);
        throw new Error("Response lost");
      }
      if (writes.length === 2) {
        assert.ok(persisted);
        return persisted;
      }
      return saved(value);
    },
    () => {},
    (status) => statuses.push(status),
  );
  writer.update("Timetable", snapshot());
  await assert.rejects(writer.flush());
  assert.equal(writer.status, "error");
  assert.equal(writer.dirty, true);
  writer.update("Timetable", {
    ...snapshot(),
    draft: "New draft after failure",
  });
  await writer.flush();
  assert.deepEqual(writes[0], writes[1]);
  assert.notEqual(writes[2].mutationId, writes[1].mutationId);
  assert.equal(writes[2].revision, 1);
  assert.equal(writer.dirty, false);
  assert.equal(statuses.at(-1), "saved");
});

test("conflicting writers preserve the local conversation as a new copy", async () => {
  const original = input();
  const writes: SaveTimetableInput[] = [];
  const writer = new TimetableWriter(
    async (value) => {
      writes.push(value);
      if (value.id === original.id) throw { data: { code: "CONFLICT" } };
      return saved(value);
    },
    () => {},
    () => {},
  );
  writer.reset(saved(original));
  writer.update("Timetable", {
    ...original.snapshot,
    draft: "Keep my local changes",
  });
  await assert.rejects(writer.flush());
  assert.equal(writer.status, "conflict");
  await writer.saveCopy();
  assert.notEqual(writes[1].id, original.id);
  assert.equal(writes[1].revision, 0);
  assert.equal(writes[1].snapshot.draft, "Keep my local changes");
  assert.equal(writes[1].name, "Timetable (copy)");
});

type Scope = { userId: string; mode: string; id: string };
type Row = Scope &
  Omit<SavedTimetable, "updatedAt"> & { mutationId: string; updatedAt: Date };
function memoryDatabase() {
  const rows = new Map<string, Row>();
  const libraries = new Map<
    string,
    { userId: string; mode: string; activeId: string | null }
  >();
  const key = (scope: Scope) => `${scope.userId}/${scope.mode}/${scope.id}`;
  const libraryKey = (scope: Omit<Scope, "id">) =>
    `${scope.userId}/${scope.mode}`;
  const db = {
    $queryRaw: async () => [],
    $transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(db),
    savedTimetable: {
      findUnique: async ({ where }: { where: { userId_mode_id: Scope } }) =>
        rows.get(key(where.userId_mode_id)) ?? null,
      findMany: async ({ where }: { where: Omit<Scope, "id"> }) =>
        [...rows.values()]
          .filter(
            (row) => row.userId === where.userId && row.mode === where.mode,
          )
          .map(
            ({
              id,
              name,
              term,
              planVersion,
              confirmed,
              revision,
              updatedAt,
              snapshot,
            }) => ({
              id,
              name,
              term,
              planVersion,
              confirmed,
              revision,
              updatedAt,
              snapshot,
            }),
          ),
      create: async ({
        data,
      }: {
        data: Omit<Row, "updatedAt" | "revision">;
      }) => {
        const row: Row = { ...data, updatedAt: new Date(), revision: 1 };
        rows.set(key(row), row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { userId_mode_id: Scope };
        data: Partial<Omit<Row, "revision">> & {
          revision?: { increment: number };
        };
      }) => {
        const current = rows.get(key(where.userId_mode_id));
        assert.ok(current);
        const row: Row = {
          ...current,
          ...data,
          revision: current.revision + (data.revision?.increment ?? 0),
          updatedAt: new Date(),
        };
        rows.set(key(row), row);
        return row;
      },
      createMany: async ({
        data,
      }: {
        data: Omit<Row, "updatedAt" | "revision">[];
      }) => {
        let count = 0;
        for (const row of data)
          if (!rows.has(key(row))) {
            await db.savedTimetable.create({ data: row });
            count++;
          }
        return { count };
      },
    },
    timetableLibrary: {
      findUnique: async ({
        where,
      }: {
        where: { userId_mode: Omit<Scope, "id"> };
      }) => libraries.get(libraryKey(where.userId_mode)) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId_mode: Omit<Scope, "id"> };
        create: { userId: string; mode: string; activeId: string };
        update: { activeId?: string };
      }) => {
        const id = libraryKey(where.userId_mode);
        const row = libraries.get(id);
        libraries.set(id, row ? { ...row, ...update } : create);
      },
    },
  };
  return db;
}
function caller(prisma: unknown, identity: unknown = user) {
  return router.createCaller({
    prisma,
    session: identity ? { user: identity } : null,
    requestHeaders: new Headers(),
    responseHeaders: new Headers(),
    canSetCookies: true,
    requestUrl: "http://localhost:3000/api/trpc",
  } as Parameters<Router["createCaller"]>[0]).savedTimetables;
}

test("all persistence operations require the eligible account shown in the page", async () => {
  for (const identity of [
    null,
    { ...user, email: "a@example.org" },
    { ...user, id: "another-account" },
  ]) {
    const api = caller({}, identity);
    for (const action of [
      () => api.list({ accountId: user.id }),
      () => api.open({ accountId: user.id, id: crypto.randomUUID() }),
      () =>
        api.remove({
          accountId: user.id,
          id: crypto.randomUUID(),
          revision: 1,
        }),
      () =>
        api.restore({
          accountId: user.id,
          id: crypto.randomUUID(),
          revision: 1,
        }),
      () => api.save({ accountId: user.id, ...input() }),
      () =>
        api.importLegacy({ accountId: user.id, activeId: null, entries: [] }),
    ])
      await assert.rejects(action, { code: "UNAUTHORIZED" });
  }
});

test("saved conversations survive fresh callers and another account cannot read or overwrite them", async () => {
  const db = memoryDatabase();
  const value = input();
  const first = await caller(db).save({ accountId: user.id, ...value });
  const reopened = await caller(db).open({ accountId: user.id, id: value.id });
  assert.deepEqual(reopened.snapshot, value.snapshot);
  assert.equal(reopened.revision, 1);
  const other = { ...user, id: "owner-b" };
  assert.deepEqual(await caller(db, other).list({ accountId: other.id }), {
    activeId: null,
    entries: [],
  });
  await assert.rejects(
    () => caller(db, other).open({ accountId: other.id, id: value.id }),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(
    () =>
      caller(db, other).save({
        accountId: other.id,
        ...value,
        revision: first.revision,
        mutationId: crypto.randomUUID(),
      }),
    { code: "CONFLICT" },
  );
  assert.deepEqual(
    (await caller(db).open({ accountId: user.id, id: value.id })).snapshot,
    value.snapshot,
  );
  const listed = await caller(db).list({ accountId: user.id });
  assert.equal(listed.entries.length, 1);
  assert.equal("snapshot" in listed.entries[0], false);
});

test("database saves are idempotent and reject stale revisions without losing newer chat", async () => {
  const db = memoryDatabase();
  const api = caller(db);
  const value = { accountId: user.id, ...input() };
  await api.save(value);
  assert.equal((await api.save(value)).revision, 1);
  const second = {
    ...value,
    revision: 1,
    mutationId: crypto.randomUUID(),
    snapshot: { ...value.snapshot, draft: "Second device's newer draft" },
  };
  await api.save(second);
  await assert.rejects(
    () => api.save({ ...value, revision: 1, mutationId: crypto.randomUUID() }),
    { code: "CONFLICT" },
  );
  assert.equal(
    (await api.open({ accountId: user.id, id: value.id })).snapshot.draft,
    second.snapshot.draft,
  );
});

test("legacy import is repeatable and never replaces a database conversation or active selection", async () => {
  const db = memoryDatabase();
  const api = caller(db);
  const value = { accountId: user.id, ...input() };
  await api.save(value);
  const imported = input();
  const batch = {
    accountId: user.id,
    activeId: imported.id,
    entries: [value, imported],
  };
  assert.equal((await api.importLegacy(batch)).imported, 1);
  assert.equal((await api.importLegacy(batch)).imported, 0);
  assert.equal((await api.list({ accountId: user.id })).activeId, value.id);
  assert.deepEqual(
    (await api.open({ accountId: user.id, id: value.id })).snapshot,
    value.snapshot,
  );
});

test("demo and real libraries are isolated on the server", async () => {
  const db = memoryDatabase();
  const value = { accountId: user.id, ...input() };
  await caller(db).save(value);
  process.env.NEXT_PUBLIC_USE_MOCK = "false";
  try {
    assert.equal(
      (await caller(db).list({ accountId: user.id })).entries.length,
      0,
    );
    await assert.rejects(
      () => caller(db).open({ accountId: user.id, id: value.id }),
      { code: "NOT_FOUND" },
    );
  } finally {
    process.env.NEXT_PUBLIC_USE_MOCK = "true";
  }
});

function plannedSnapshot(): PlannerSnapshot {
  const value = snapshot();
  value.plan = {
    plan_id: "plan-v1",
    version: 1,
    changed: true,
    rules: value.rules,
    sections: [
      {
        key: "class-a",
        code: "FIT1001",
        title: "Programming",
        kind: "Lecture",
        section: "L1",
        day: 1,
        start: "10:00",
        end: "11:00",
        room: "R1",
        credits: 6,
        with_friend: false,
        changed: false,
      },
    ],
    match_pct: 100,
    scores: [
      {
        rule_id: "friday",
        label: "Friday off",
        status: "met",
        note: "No Friday classes",
      },
    ],
    summary: { sections: 1, credits: 6, hold_minutes: 0 },
    message: { text: "Built your timetable.", steps: [] },
  };
  value.phase = "adjust";
  value.items.push({
    id: crypto.randomUUID(),
    role: "user",
    text: "What time is my Monday class?",
  });
  value.items.push({
    id: crypto.randomUUID(),
    role: "ai",
    animate: false,
    message: { text: "Monday at 10:00.", steps: [] },
  });
  value.items.push({
    id: crypto.randomUUID(),
    role: "ai",
    animate: false,
    error: true,
    message: {
      text: "A previous request failed.",
      steps: [],
      note: "Try again",
    },
  });
  return value;
}

test("confirmed timetables retain sections, read-only chat answers, errors and confirmation after reload", async () => {
  const db = memoryDatabase();
  const value = plannedSnapshot();
  value.confirmation = {
    reference: "CONF-1",
    confirmed_at: "2026-10-17T00:00:00Z",
    courses: 1,
    sections: 1,
    credits: 6,
    swap_deadline: "2026-10-30",
    message: { text: "Enrolment confirmed.", steps: [] },
  };
  value.phase = "confirmed";
  const created = await caller(db).save({
    accountId: user.id,
    ...input(),
    snapshot: value,
  });
  const opened = await caller(db).open({ accountId: user.id, id: created.id });
  const restored = reducer(initialState, {
    type: "OPEN_TIMETABLE",
    snapshot: opened.snapshot,
  });
  assert.equal(restored.phase, "confirmed");
  assert.deepEqual(restored.plan, value.plan);
  assert.deepEqual(restored.confirmation, value.confirmation);
  assert.deepEqual(restored.items, value.items);
});

test("reopening recovers an adjustment and booking committed before the browser saved the response", async () => {
  const db = memoryDatabase();
  const value = plannedSnapshot();
  const head = {
    ...value.plan,
    plan_id: "plan-v2",
    version: 2,
    message: { text: "Moved your class earlier.", steps: [] },
  };
  const confirmation = {
    reference: "CONF-recovered",
    confirmed_at: "2026-10-17T00:00:00Z",
    courses: 1,
    sections: 1,
    credits: 6,
    swap_deadline: "2026-10-30",
    message: { text: "Booking recovered.", steps: [] },
  };
  const database = {
    ...db,
    $transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(database),
    plannerPlan: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; family?: { ownerId: string }; familyId?: string };
      }) => {
        if (where.family) {
          assert.equal(where.family?.ownerId, user.id);
          return {
            familyId: "family-a",
            family: { head: "plan-v2", confirmation },
          };
        }
        assert.equal(where.familyId, "family-a");
        return { body: head };
      },
    },
  };
  process.env.NEXT_PUBLIC_USE_MOCK = "false";
  try {
    const created = await caller(database).save({
      accountId: user.id,
      ...input(),
      snapshot: value,
    });
    const recovered = await caller(database).open({
      accountId: user.id,
      id: created.id,
    });
    assert.equal(recovered.revision, 2);
    assert.equal(recovered.snapshot.plan?.plan_id, "plan-v2");
    assert.equal(
      recovered.snapshot.confirmation?.reference,
      confirmation.reference,
    );
    assert.equal(recovered.snapshot.items.length, value.items.length + 2);
    const again = await caller(database).open({
      accountId: user.id,
      id: created.id,
    });
    assert.equal(again.revision, 2);
    assert.deepEqual(again.snapshot.items, recovered.snapshot.items);
  } finally {
    process.env.NEXT_PUBLIC_USE_MOCK = "true";
  }
});

test("deletion hides saved chats, rejects stale writes and legacy resurrection, and supports undo", async () => {
  const db = memoryDatabase();
  const api = caller(db);
  const value = { accountId: user.id, ...input() };
  const first = await api.save(value);
  const other = { ...user, id: "another-owner" };
  await assert.rejects(
    () =>
      caller(db, other).remove({
        accountId: other.id,
        id: value.id,
        revision: 1,
      }),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(
    () => api.remove({ accountId: user.id, id: value.id, revision: 2 }),
    { code: "CONFLICT" },
  );
  const removed = await api.remove({
    accountId: user.id,
    id: value.id,
    revision: first.revision,
  });
  assert.deepEqual(await api.list({ accountId: user.id }), {
    activeId: null,
    entries: [],
  });
  await assert.rejects(() => api.open({ accountId: user.id, id: value.id }), {
    code: "NOT_FOUND",
  });
  await assert.rejects(
    () => api.save({ ...value, revision: 1, mutationId: crypto.randomUUID() }),
    { code: "CONFLICT" },
  );
  await assert.rejects(() => api.save(value), { code: "CONFLICT" });
  await api.importLegacy({
    accountId: user.id,
    activeId: value.id,
    entries: [value],
  });
  assert.equal((await api.list({ accountId: user.id })).entries.length, 0);
  assert.deepEqual(
    await api.remove({ accountId: user.id, id: value.id, revision: 1 }),
    removed,
  );
  const restored = await api.restore({ accountId: user.id, ...removed });
  assert.deepEqual(restored.snapshot, first.snapshot);
  assert.equal((await api.list({ accountId: user.id })).entries.length, 1);
  await assert.rejects(
    () => api.remove({ accountId: user.id, id: value.id, revision: 1 }),
    { code: "CONFLICT" },
  );
});

test("reopening a confirmed snapshot unlocks a draft and preserves conversation and kept classes", async () => {
  const snapshot = plannedSnapshot();
  snapshot.confirmation = {
    reference: "confirmed",
    confirmed_at: new Date().toISOString(),
    courses: 1,
    sections: 1,
    credits: 6,
    swap_deadline: "2026-12-01",
    message: { steps: [], text: "Confirmed" },
  };
  snapshot.phase = "confirmed";
  const state = reducer(initialState, { type: "OPEN_TIMETABLE", snapshot });
  assert.ok(state.plan);
  const copy = { ...state.plan, plan_id: "editable-copy", version: 1 };
  const revised = reducer(state, { type: "REOPENED", plan: copy });
  assert.equal(revised.phase, "adjust");
  assert.equal(revised.confirmation, null);
  assert.deepEqual(revised.items, state.items);
  assert.equal(state.confirmation?.reference, "confirmed");
  assert.equal(
    snapshotSchema.parse(snapshotOf(revised)).plan?.plan_id,
    "editable-copy",
  );
});
