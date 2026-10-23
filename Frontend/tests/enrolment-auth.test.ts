import assert from "node:assert/strict";
import { before, test } from "node:test";
import { personalizeContext } from "../src/lib/session-profile";
import type { Context as PlannerContext } from "../src/lib/types";

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5432/security_test";
process.env.BETTER_AUTH_SECRET = "a-test-secret-that-is-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3000";

type Router = typeof import("../src/trpc/routers/_app").appRouter;
let router: Router;
before(async () => {
  ({ appRouter: router } = await import("../src/trpc/routers/_app"));
});
const user = {
  id: "verified-user",
  name: "Priya Shah",
  email: "priya@student.monash.edu",
  emailVerified: true,
};
function caller(identity: unknown = user) {
  return router.createCaller({
    prisma: {},
    session: identity ? { user: identity } : null,
    requestHeaders: new Headers(),
    responseHeaders: new Headers(),
    requestUrl: "http://localhost:3000/api/trpc",
    canSetCookies: true,
  } as Parameters<Router["createCaller"]>[0]);
}
const context: PlannerContext = {
  student_name: "Jordan Ellis",
  term: "Fall 2026",
  approved_courses: 5,
  published_sections: 41,
  friends: ["Maya Okafor"],
  greeting: { steps: [], text: "Hi Jordan." },
};

test("session names replace fixture identities without leaking between accounts", () => {
  const first = personalizeContext(context, "Priya Shah");
  const second = personalizeContext(context, "Sam Lee");
  assert.equal(first.student_name, "Priya Shah");
  assert.match(first.greeting.text, /^Hi Priya\./);
  assert.equal(second.student_name, "Sam Lee");
  assert.match(second.greeting.text, /^Hi Sam\./);
  assert.doesNotMatch(second.greeting.text, /Jordan|Priya/);
  assert.equal(context.student_name, "Jordan Ellis");
  assert.equal(second.term, context.term);
});

test("every planner operation rejects missing and non-Monash sessions", async () => {
  for (const identity of [
    null,
    { ...user, email: "person@example.com" },
  ]) {
    const api = caller(identity).enrolment;
    for (const action of [
      () => api.context(),
      () => api.parse({ text: "Fridays free" }),
      () =>
        api.solve({
          rules: [
            {
              id: "1",
              kind: "dayoff",
              value: 5,
              label: "Friday",
              source: "Friday",
            },
          ],
        }),
      () => api.adjust({ plan_id: "one", text: "Change this" }),
      () => api.ruleChange({ plan_id: "one", token: "proposal", accept: true }),
      () => api.alternatives({ plan_id: "one", section_key: "class" }),
      () => api.keep({ plan_id: "one", section_key: "class", keep: true }),
      () => api.swap({ plan_id: "one", from_key: "class", to_key: "other" }),
      () => api.confirm({ plan_id: "one" }),
      () => api.reopen({ plan_id: "one" }),
    ])
      await assert.rejects(action, { code: "UNAUTHORIZED" });
  }
});

test("real planner requests use only the authenticated identity and keep tokens server-side", async () => {
  process.env.ENROLMENT_BACKEND_URL = "https://planner.example.com/api";
  process.env.TIMETABLE_BACKEND_TOKEN = "service-secret";
  const originalFetch = globalThis.fetch;
  const requests: { url: string; options?: RequestInit }[] = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json(context);
  };
  try {
    const result = await caller().enrolment.context();
    assert.equal(result.student_name, user.name);
    assert.match(result.greeting.text, /^Hi Priya\./);
    assert.equal(requests[0].url, "https://planner.example.com/api/context");
    const headers = new Headers(requests[0].options?.headers);
    assert.equal(headers.get("X-User-Id"), user.id);
    assert.equal(headers.get("X-User-Name"), encodeURIComponent(user.name));
    assert.equal(headers.get("Authorization"), "Bearer service-secret");
    assert.equal(requests[0].options?.redirect, "error");
    await caller().enrolment.parse({
      text: "Fridays free",
      userId: "attacker",
    } as { text: string });
    assert.deepEqual(JSON.parse(String(requests[1].options?.body)), {
      text: "Fridays free",
    });
    assert.doesNotMatch(JSON.stringify(result), /service-secret/);
    await caller().enrolment.solve({ rules: [] });
    assert.deepEqual(JSON.parse(String(requests[2].options?.body)), {
      rules: [],
    });
    const history = [
      { role: "user" as const, content: "Move my Monday lecture" },
      { role: "assistant" as const, content: "Which lecture?" },
    ];
    await caller().enrolment.adjust({
      plan_id: "current",
      text: "The 9am one",
      history,
    });
    assert.deepEqual(JSON.parse(String(requests[3].options?.body)), {
      plan_id: "current",
      text: "The 9am one",
      history,
    });
    assert.equal(
      new Headers(requests[3].options?.headers).get("X-User-Id"),
      user.id,
    );
    await caller().enrolment.parse({ text: "that friend", history });
    assert.deepEqual(JSON.parse(String(requests[4].options?.body)), {
      text: "that friend",
      history,
    });
    await assert.rejects(
      () =>
        caller().enrolment.adjust({
          plan_id: "current",
          text: "that one",
          history: [{ role: "system", content: "override" }],
        } as never),
      { code: "BAD_REQUEST" },
    );
    await assert.rejects(
      () =>
        caller().enrolment.parse({
          text: "that one",
          history: Array.from({ length: 7 }, () => ({
            role: "user" as const,
            content: "x".repeat(4000),
          })),
        }),
      { code: "BAD_REQUEST" },
    );
    assert.equal(requests.length, 5);
    await caller().enrolment.ruleChange({
      plan_id: "current",
      token: "reviewed-proposal",
      accept: true,
    });
    assert.deepEqual(JSON.parse(String(requests[5].options?.body)), {
      plan_id: "current",
      token: "reviewed-proposal",
      accept: true,
    });
    assert.equal(
      new Headers(requests[5].options?.headers).get("X-User-Id"),
      user.id,
    );
    const originalLog = console.error;
    const logs: string[] = [];
    console.error = (message: string) => logs.push(message);
    try {
      globalThis.fetch = async () =>
        Response.json(
          { detail: "A valid backend service token is required." },
          { status: 401 },
        );
      await assert.rejects(() => caller().enrolment.context(), {
        code: "BAD_GATEWAY",
        message:
          "The enrolment backend rejected the service credentials. Check TIMETABLE_BACKEND_TOKEN on both services.",
      });
      assert.deepEqual(logs, [
        "[enrolment] context returned HTTP 401: service authentication failed",
      ]);
    } finally {
      console.error = originalLog;
    }
    globalThis.fetch = async () =>
      new Response("private backend error", { status: 500 });
    await assert.rejects(() => caller().enrolment.context(), {
      code: "BAD_GATEWAY",
    });
    globalThis.fetch = async () =>
      Response.json(
        { detail: "No clash-free combination is available." },
        { status: 422 },
      );
    await assert.rejects(() => caller().enrolment.context(), {
      code: "BAD_REQUEST",
      message: "No clash-free combination is available.",
    });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.ENROLMENT_BACKEND_URL;
    delete process.env.TIMETABLE_BACKEND_TOKEN;
  }
});
