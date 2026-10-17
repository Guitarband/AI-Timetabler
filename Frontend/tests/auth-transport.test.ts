import assert from "node:assert/strict";
import { before, test } from "node:test";
import { forwardAuthCookies } from "../src/lib/auth-cookies";
import { rejectUnsafeRequest } from "../src/trpc/http";

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5432/security_test";
process.env.BETTER_AUTH_SECRET = "a-test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";

let auth: typeof import("../src/lib/auth").auth;
let appRouter: typeof import("../src/trpc/routers/_app").appRouter;
let http: typeof import("../src/app/api/trpc/[trpc]/route");
before(async () => {
  ({ auth } = await import("../src/lib/auth"));
  ({ appRouter } = await import("../src/trpc/routers/_app"));
  http = await import("../src/app/api/trpc/[trpc]/route");
});

function context() {
  return {
    prisma: {},
    session: null,
    requestUrl: "http://localhost:3000/api/trpc",
    requestHeaders: new Headers({ origin: "http://localhost:3000" }),
    responseHeaders: new Headers(),
    canSetCookies: true,
  } as Awaited<ReturnType<typeof import("../src/trpc/init").createTRPCContext>>;
}

test("tRPC rejects foreign origins, opaque origins and form-based mutations", () => {
  const request = (headers: Record<string, string>, method = "POST") =>
    new Request("http://localhost:3000/api/trpc", { method, headers });
  assert.equal(
    rejectUnsafeRequest(
      request({
        origin: "https://evil.example",
        "content-type": "application/json",
      }),
    )?.status,
    403,
  );
  assert.equal(
    rejectUnsafeRequest(
      request({ origin: "null", "content-type": "application/json" }),
    )?.status,
    403,
  );
  assert.equal(
    rejectUnsafeRequest(request({ "sec-fetch-site": "cross-site" }, "GET"))
      ?.status,
    403,
  );
  assert.equal(
    rejectUnsafeRequest(
      request({ "content-type": "application/x-www-form-urlencoded" }),
    )?.status,
    415,
  );
  assert.equal(
    rejectUnsafeRequest(
      request({
        origin: "http://localhost:3000",
        "content-type": "application/json; charset=utf-8",
      }),
    ),
    null,
  );
});

test("every Set-Cookie header survives forwarding", () => {
  const source = new Headers();
  source.append("set-cookie", "session=abc; HttpOnly; Path=/");
  source.append("set-cookie", "session_data=; Max-Age=0; Path=/");
  const destination = new Headers();
  forwardAuthCookies(source, destination);
  assert.deepEqual(destination.getSetCookie(), source.getSetCookie());
});

test("sign-in uses Better Auth's handler, forwards cookies and hides tokens", async () => {
  const previous = auth.handler;
  const ctx = context();
  auth.handler = async (req) => {
    assert.equal(new URL(req.url).pathname, "/api/auth/sign-in/email");
    assert.equal(req.headers.get("origin"), "http://localhost:3000");
    assert.deepEqual(await req.json(), {
      email: "student@student.monash.edu",
      password: "valid-password",
    });
    const headers = new Headers();
    headers.append("set-cookie", "session=secret; HttpOnly; Path=/");
    headers.append("set-cookie", "other=value; Path=/");
    return Response.json(
      { token: "must-not-be-returned", user: { studentId: "12345678" } },
      { headers },
    );
  };
  try {
    assert.deepEqual(
      await appRouter.createCaller(ctx).auth.signIn({
        email: " STUDENT@STUDENT.MONASH.EDU ",
        password: "valid-password",
      }),
      { signedIn: true },
    );
    assert.equal(ctx.responseHeaders.getSetCookie().length, 2);
  } finally {
    auth.handler = previous;
  }
});

test("a rate-limited auth operation remains rate-limited through tRPC", async () => {
  const previous = auth.handler;
  auth.handler = async () => new Response(null, { status: 429 });
  try {
    await assert.rejects(
      appRouter.createCaller(context()).auth.signIn({
        email: "student@student.monash.edu",
        password: "valid-password",
      }),
      { code: "TOO_MANY_REQUESTS" },
    );
  } finally {
    auth.handler = previous;
  }
});

test("the actual batched HTTP route forwards cookies without exposing auth tokens", async () => {
  const previous = auth.handler;
  auth.handler = async () => {
    const headers = new Headers();
    headers.append("set-cookie", "session=secret; HttpOnly; Path=/");
    headers.append("set-cookie", "session_data=data; HttpOnly; Path=/");
    return Response.json({ token: "private-token" }, { headers });
  };
  try {
    const response = await http.POST(
      new Request("http://localhost:3000/api/trpc/auth.signIn?batch=1", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          0: {
            email: "student@student.monash.edu",
            password: "valid-password",
          },
        }),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.getSetCookie().length, 2);
    assert.deepEqual(await response.json(), [
      { result: { data: { signedIn: true } } },
    ]);
  } finally {
    auth.handler = previous;
  }
});

test("batching a public session read with a protected read cannot bypass authentication", async () => {
  const response = await http.GET(
    new Request(
      "http://localhost:3000/api/trpc/auth.session,profile.me?batch=1",
    ),
  );
  assert.equal(response.status, 207);
  const result = await response.json();
  assert.deepEqual(result[0].result.data, { signedIn: false, user: null });
  assert.equal(result[1].error.data.code, "UNAUTHORIZED");
});

test("HTTP requests cannot hide oversized batches or mutate through GET", async () => {
  const paths = Array(11).fill("auth.session").join(",");
  assert.equal(
    (
      await http.GET(
        new Request(`http://localhost:3000/api/trpc/${paths}?batch=1`),
      )
    ).status,
    400,
  );
  assert.equal(
    (await http.GET(new Request("http://localhost:3000/api/trpc/auth.signOut")))
      .status,
    405,
  );
});

test("sign-out remains available to expired or ineligible accounts", async () => {
  const previous = auth.handler;
  auth.handler = async () =>
    Response.json(
      { success: true },
      { headers: { "set-cookie": "session=; Max-Age=0; Path=/" } },
    );
  try {
    const ctx = context();
    assert.deepEqual(await appRouter.createCaller(ctx).auth.signOut(), {
      signedOut: true,
    });
    assert.match(ctx.responseHeaders.getSetCookie()[0], /Max-Age=0/);
  } finally {
    auth.handler = previous;
  }
});

test("server-component callers cannot perform mutations without a cookie response", async () => {
  const ctx = context();
  ctx.canSetCookies = false;
  await assert.rejects(appRouter.createCaller(ctx).auth.signOut(), {
    code: "METHOD_NOT_SUPPORTED",
  });
  assert.deepEqual(await appRouter.createCaller(ctx).auth.session(), {
    signedIn: false,
    user: null,
  });
});

test("database hooks protect direct creation and identity updates", async () => {
  const create = auth.options.databaseHooks.user.create.before;
  const update = auth.options.databaseHooks.user.update.before;
  const user = {
    id: "u1",
    email: "person@fake-monash.edu",
    name: "Test",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  assert.equal(await create(user), false);
  assert.equal(
    await create({ ...user, email: "student@student.monash.edu" }),
    false,
  );
  const valid = await create({ ...user, email: "STAFF@MONASH.EDU" });
  assert.ok(valid);
  assert.equal(valid.data.email, "staff@monash.edu");
  assert.equal(await update({ studentId: "87654321" }), false);
  assert.equal(await update({ email: "person@fake-monash.edu" }), false);
});

test("the actual Better Auth handler rate-limits repeated invalid signup attempts", async () => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email: "invalid", password: "x", name: "Test" }),
      }),
    );
    statuses.push(response.status);
  }
  assert.ok(statuses.slice(0, 3).every((status) => status === 400));
  assert.equal(statuses[3], 429);
});
