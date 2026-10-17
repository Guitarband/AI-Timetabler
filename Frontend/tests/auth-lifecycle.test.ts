import assert from "node:assert/strict";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5432/security_test";
process.env.BETTER_AUTH_SECRET = "a-test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.AUTH_EMAIL_WEBHOOK_URL = "https://mail.example.com/send";
process.env.AUTH_EMAIL_WEBHOOK_TOKEN = "test-token";

test("real auth lifecycle verifies mail ownership, locks identity and revokes reset sessions", async () => {
  const { auth } = await import("../src/lib/auth");
  const database = { user: [], session: [], account: [], verification: [] };
  let verificationUrl = "";
  let resetToken = "";
  const instance = betterAuth({
    ...auth.options,
    database: memoryAdapter(database),
    baseURL: "http://localhost:3000",
    // Rate limits have their own HTTP test; this test exercises the full flow.
    rateLimit: { enabled: false },
    emailVerification: {
      ...auth.options.emailVerification,
      sendVerificationEmail: async ({ url }) => {
        verificationUrl = url;
      },
    },
    emailAndPassword: {
      ...auth.options.emailAndPassword,
      sendResetPassword: async ({ token }) => {
        resetToken = token;
      },
    },
  });
  const request = (path: string, body?: unknown, cookie?: string) =>
    instance.handler(
      new Request(`http://localhost:3000/api/auth/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  const credentials = {
    email: "student@student.monash.edu",
    password: "original-password",
  };
  const signup = await request("sign-up/email", {
    ...credentials,
    name: "Student",
    studentId: "12345678",
  });
  assert.equal(signup.status, 200);
  assert.equal(database.user.length, 1);
  const signupData = await signup.json();
  assert.equal(signupData.token, null);
  assert.equal(signupData.user.studentId, undefined);
  assert.ok(verificationUrl);
  assert.equal((await request("sign-in/email", credentials)).status, 403);

  const verified = await instance.handler(new Request(verificationUrl));
  assert.ok(verified.ok || verified.status === 302);
  const login = await request("sign-in/email", credentials);
  assert.equal(login.status, 200);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie);
  assert.ok(
    (await (await request("get-session", undefined, cookie)).json()).user,
  );

  await request("update-user", { studentId: "87654321" }, cookie);
  const storedUser = database.user[0] as {
    studentId: string;
    emailVerified: boolean;
  };
  assert.equal(storedUser.studentId, "12345678");
  assert.equal(storedUser.emailVerified, true);

  assert.equal(
    (
      await request("request-password-reset", {
        email: credentials.email,
        redirectTo: "/reset-password",
      })
    ).status,
    200,
  );
  assert.ok(resetToken);
  assert.equal(
    (
      await request("reset-password", {
        token: resetToken,
        newPassword: "replacement-password",
      })
    ).status,
    200,
  );
  assert.equal(
    await (await request("get-session", undefined, cookie)).json(),
    null,
  );
  assert.equal((await request("sign-in/email", credentials)).status, 401);
  assert.equal(
    (
      await request("sign-in/email", {
        ...credentials,
        password: "replacement-password",
      })
    ).status,
    200,
  );
  assert.notEqual(
    (
      await request("reset-password", {
        token: resetToken,
        newPassword: "reuse-token-password",
      })
    ).status,
    200,
  );

  // Direct Better Auth calls cannot create accounts outside the app's policy.
  for (const input of [
    { email: "person@fake-monash.edu" },
    { email: "other@student.monash.edu" },
    { email: "staff@monash.edu", studentId: "12345678" },
  ]) {
    await request("sign-up/email", {
      name: "Invalid",
      password: "valid-password",
      ...input,
    });
  }
  assert.equal(database.user.length, 1);
});
