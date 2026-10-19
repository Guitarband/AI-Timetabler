import assert from "node:assert/strict";
import { before, test } from "node:test";
import { isAuthEmailConfigured } from "../src/lib/auth-email";
import { isMonashEmail } from "../src/lib/monash-email";
import { isStudentId } from "../src/lib/student-id";

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5432/security_test";
process.env.BETTER_AUTH_SECRET = "a-test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";

type AppRouter = typeof import("../src/trpc/routers/_app").appRouter;
type Context = Parameters<AppRouter["createCaller"]>[0];
let appRouter: AppRouter;

before(async () => {
  ({ appRouter } = await import("../src/trpc/routers/_app"));
});

const verifiedUser = {
  id: "student-1",
  name: "Student",
  email: "student@student.monash.edu",
  emailVerified: true,
};

function caller(prisma: unknown = {}, user: unknown = verifiedUser) {
  return appRouter.createCaller({
    prisma,
    session: user ? { user } : null,
    requestHeaders: new Headers(),
    responseHeaders: new Headers(),
    requestUrl: "http://localhost:3000/api/trpc",
    canSetCookies: true,
  } as Context);
}

test("Monash domains and student IDs are checked exactly", () => {
  for (const address of [
    "lecturer@monash.edu",
    "student@student.monash.edu",
    "STUDENT@STUDENT.MONASH.EDU",
  ]) {
    assert.equal(isMonashEmail(address), true, address);
  }
  for (const address of [
    "person@example.com",
    "person@fake-monash.edu",
    "person@monash.edu.example.com",
    "person@sub.monash.edu",
    "person@@monash.edu",
    "@monash.edu",
  ]) {
    assert.equal(isMonashEmail(address), false, address);
  }
  assert.equal(isStudentId("12345678"), true);
  assert.equal(isStudentId("12345"), false);
  assert.equal(isStudentId("123456a"), false);
});

test("email delivery must have an HTTPS endpoint and token", () => {
  const previousUrl = process.env.AUTH_EMAIL_WEBHOOK_URL;
  const previousToken = process.env.AUTH_EMAIL_WEBHOOK_TOKEN;
  try {
    delete process.env.AUTH_EMAIL_WEBHOOK_URL;
    delete process.env.AUTH_EMAIL_WEBHOOK_TOKEN;
    assert.equal(isAuthEmailConfigured(), false);
    process.env.AUTH_EMAIL_WEBHOOK_URL = "http://example.com/send";
    process.env.AUTH_EMAIL_WEBHOOK_TOKEN = "secret";
    assert.equal(isAuthEmailConfigured(), false);
    process.env.AUTH_EMAIL_WEBHOOK_URL = "https://mail.example.com/send";
    assert.equal(isAuthEmailConfigured(), true);
  } finally {
    if (previousUrl === undefined) delete process.env.AUTH_EMAIL_WEBHOOK_URL;
    else process.env.AUTH_EMAIL_WEBHOOK_URL = previousUrl;
    if (previousToken === undefined)
      delete process.env.AUTH_EMAIL_WEBHOOK_TOKEN;
    else process.env.AUTH_EMAIL_WEBHOOK_TOKEN = previousToken;
  }
});

test("missing or non-Monash sessions cannot call protected procedures", async () => {
  const invalidUsers = [
    null,
    { ...verifiedUser, email: "person@example.com" },
  ];

  for (const user of invalidUsers) {
    const client = caller({}, user);
    const actions = [
      () => client.profile.me(),
      () => client.preferences.get(),
      () =>
        client.preferences.save({
          earliestStartMinute: 540,
          latestEndMinute: 1080,
          preferredDays: [],
          avoidedDays: [],
          maxCampusDays: null,
          prioritizeFriends: true,
        }),
      () => client.friends.list(),
      () => client.friends.request({ email: "friend@student.monash.edu" }),
      () => client.friends.respond({ id: "friendship-1", action: "accept" }),
      () => client.friends.remove({ id: "friendship-1" }),
      () => client.peerData.list(),
      () => client.peerData.lookup({ studentId: "12345678" }),
      () => client.peerData.request({ studentId: "12345678" }),
      () => client.peerData.respond({ id: "request-1", decision: "ACCEPTED" }),
      () =>
        client.peerData.changeAccess({ id: "request-1", decision: "DENIED" }),
      () => client.peerData.cancel({ id: "request-1" }),
      () => client.timetable.viewPeer({ userId: "student-2" }),
      () => client.timetable.calculate(),
    ];
    for (const action of actions) {
      await assert.rejects(action, { code: "UNAUTHORIZED" });
    }
  }
});

test("signup input enforces matching Monash account types", async () => {
  const client = caller();
  const base = { name: "Example", password: "a-long-password" };
  await assert.rejects(
    client.auth.signUp({ ...base, email: "person@example.com" }),
    { code: "BAD_REQUEST" },
  );
  await assert.rejects(
    client.auth.signUp({ ...base, email: "student@student.monash.edu" }),
    { code: "BAD_REQUEST" },
  );
  await assert.rejects(
    client.auth.signUp({
      ...base,
      email: "teacher@monash.edu",
      studentId: "12345678",
    }),
    { code: "BAD_REQUEST" },
  );
});

test("peer requests use student ID and only the recipient can decide access", async () => {
  const observed: Record<string, unknown> = {};
  const client = caller({
    user: {
      findUnique: async (args: unknown) => {
        observed.lookup = args;
        return {
          id: "student-2",
          name: "Friend",
          email: "friend@student.monash.edu",
          emailVerified: true,
        };
      },
    },
    peerDataRequest: {
      findMany: async () => [
        {
          id: "r1",
          status: "PARTIAL",
          requesterId: "student-1",
          requester: {
            id: "student-1",
            name: "Student",
            email: "student@student.monash.edu",
          },
          recipient: {
            id: "student-2",
            name: "Friend",
            email: "friend@student.monash.edu",
          },
          createdAt: new Date("2026-10-01T00:00:00Z"),
          respondedAt: new Date("2026-10-02T00:00:00Z"),
        },
      ],
      create: async (args: unknown) => {
        observed.request = args;
      },
      updateMany: async (args: unknown) => {
        observed.decision = args;
        return { count: 1 };
      },
      deleteMany: async (args: unknown) => {
        observed.cancel = args;
        return { count: 1 };
      },
    },
  });

  assert.deepEqual(await client.peerData.request({ studentId: "12345678" }), {
    submitted: true,
  });
  assert.deepEqual((observed.lookup as { where: unknown }).where, {
    studentId: "12345678",
  });
  assert.deepEqual(await client.peerData.lookup({ studentId: "12345678" }), {
    id: "student-2",
    name: "Friend",
  });
  assert.deepEqual((observed.request as { data: unknown }).data, {
    requesterId: "student-1",
    recipientId: "student-2",
  });
  assert.deepEqual((await client.peerData.list())[0]?.user, {
    id: "student-2",
    name: "Friend",
  });
  assert.deepEqual(
    await client.peerData.respond({ id: "r1", decision: "PARTIAL" }),
    {
      status: "PARTIAL",
    },
  );
  assert.deepEqual((observed.decision as { where: unknown }).where, {
    id: "r1",
    recipientId: "student-1",
    status: "PENDING",
  });
  assert.deepEqual(await client.peerData.cancel({ id: "r1" }), {
    cancelled: true,
  });
  assert.deepEqual((observed.cancel as { where: unknown }).where, {
    id: "r1",
    requesterId: "student-1",
  });
});

test("peer timetable placeholder requires an accepted or partial grant", async () => {
  let status: "PENDING" | "ACCEPTED" | "PARTIAL" | "DENIED" | null = null;
  const observed: Record<string, unknown> = {};
  const client = caller({
    peerDataRequest: {
      findUnique: async (args: unknown) => {
        observed.query = args;
        return status ? { status } : null;
      },
    },
  });

  for (status of [null, "PENDING", "DENIED"] as const) {
    await assert.rejects(client.timetable.viewPeer({ userId: "student-2" }), {
      code: "FORBIDDEN",
    });
  }
  for (status of ["ACCEPTED", "PARTIAL"] as const) {
    assert.deepEqual(
      await client.timetable.viewPeer({ userId: "student-2" }),
      {},
    );
  }
  assert.deepEqual((observed.query as { where: unknown }).where, {
    requesterId_recipientId: {
      requesterId: "student-1",
      recipientId: "student-2",
    },
  });
});

test("calculation sends only the authenticated user ID to the backend", async () => {
  const previousUrl = process.env.TIMETABLE_BACKEND_URL;
  const previousToken = process.env.TIMETABLE_BACKEND_TOKEN;
  const previousFetch = globalThis.fetch;
  const observed: Record<string, unknown> = {};

  try {
    delete process.env.TIMETABLE_BACKEND_URL;
    delete process.env.TIMETABLE_BACKEND_TOKEN;
    await assert.rejects(caller().timetable.calculate(), {
      code: "PRECONDITION_FAILED",
    });

    process.env.TIMETABLE_BACKEND_URL = "https://backend.example.com/calculate";
    process.env.TIMETABLE_BACKEND_TOKEN = "service-secret";
    globalThis.fetch = async (input, init) => {
      observed.url = String(input);
      observed.options = init;
      return new Response(null, { status: 202 });
    };

    assert.deepEqual(await caller().timetable.calculate(), { submitted: true });
    assert.equal(observed.url, "https://backend.example.com/calculate");
    const options = observed.options as RequestInit;
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(String(options.body)), { userId: "student-1" });
    assert.deepEqual(options.headers, {
      Authorization: "Bearer service-secret",
      "Content-Type": "application/json",
    });

    globalThis.fetch = async () => new Response(null, { status: 500 });
    await assert.rejects(caller().timetable.calculate(), {
      code: "BAD_GATEWAY",
    });
  } finally {
    if (previousUrl === undefined) delete process.env.TIMETABLE_BACKEND_URL;
    else process.env.TIMETABLE_BACKEND_URL = previousUrl;
    if (previousToken === undefined) delete process.env.TIMETABLE_BACKEND_TOKEN;
    else process.env.TIMETABLE_BACKEND_TOKEN = previousToken;
    globalThis.fetch = previousFetch;
  }
});
