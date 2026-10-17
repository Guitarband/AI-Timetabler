import assert from "node:assert/strict";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
  isEligibleUser,
  requiresEmailVerification,
} from "../src/lib/auth-policy";

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5432/security_test";
process.env.BETTER_AUTH_SECRET = "a-test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";

test("verification bypass requires both development and an explicit opt-in", () => {
  const user = { email: "test@student.monash.edu", emailVerified: false };
  for (const mode of ["production", "test", "development"]) {
    for (const flag of ["true", "false", ""]) {
      Object.assign(process.env, {
        NODE_ENV: mode,
        AUTH_REQUIRE_EMAIL_VERIFICATION: flag,
      });
      const bypass = mode === "development" && flag === "false";
      assert.equal(requiresEmailVerification(), !bypass);
      assert.equal(isEligibleUser(user), bypass);
      assert.equal(isEligibleUser({ ...user, emailVerified: true }), true);
      assert.equal(
        isEligibleUser({ ...user, email: "test@example.com" }),
        false,
      );
      assert.equal(isEligibleUser(null), false);
    }
  }
});

test("local signup and login work without email delivery or falsifying verification", async () => {
  Object.assign(process.env, {
    NODE_ENV: "development",
    AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
  });
  delete process.env.AUTH_EMAIL_WEBHOOK_URL;
  delete process.env.AUTH_EMAIL_WEBHOOK_TOKEN;
  const { auth } = await import("../src/lib/auth");
  const database = { user: [], session: [], account: [], verification: [] };
  let emails = 0;
  const instance = betterAuth({
    ...auth.options,
    database: memoryAdapter(database),
    baseURL: "http://localhost:3000",
    rateLimit: { enabled: false },
    emailVerification: {
      ...auth.options.emailVerification,
      sendVerificationEmail: async () => {
        emails += 1;
      },
    },
  });
  const request = (path: string, body: unknown) =>
    instance.handler(
      new Request(`http://localhost:3000/api/auth/${path}`, {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  const credentials = {
    email: "local-test@student.monash.edu",
    password: "local-test-password",
  };
  const signup = await request("sign-up/email", {
    ...credentials,
    name: "Local Test",
    studentId: "12345678",
  });
  assert.equal(signup.status, 200);
  assert.equal((await signup.json()).user.emailVerified, false);
  const login = await request("sign-in/email", credentials);
  assert.equal(login.status, 200);
  assert.ok(login.headers.getSetCookie().length);
  const result = await login.json();
  assert.equal(result.user.emailVerified, false);
  assert.equal(isEligibleUser(result.user), true);
  assert.equal(emails, 0);

  const { appRouter } = await import("../src/trpc/routers/_app");
  const caller = appRouter.createCaller({
    prisma: {},
    session: { user: result.user },
    requestHeaders: new Headers(),
    responseHeaders: new Headers(),
    requestUrl: "http://localhost:3000/api/trpc",
    canSetCookies: true,
  } as Parameters<typeof appRouter.createCaller>[0]);
  assert.equal((await caller.auth.session()).signedIn, true);
  const fetchBefore = globalThis.fetch;
  process.env.ENROLMENT_BACKEND_URL = "http://127.0.0.1:8000";
  process.env.TIMETABLE_BACKEND_TOKEN = "test-only-token";
  globalThis.fetch = async () =>
    Response.json({ student_name: "Local Test", greeting: { text: "Hello" } });
  try {
    assert.equal((await caller.enrolment.context()).student_name, "Local Test");
  } finally {
    globalThis.fetch = fetchBefore;
  }
});
