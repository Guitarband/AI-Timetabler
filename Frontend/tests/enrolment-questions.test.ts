import assert from "node:assert/strict";
import { test } from "node:test";
import { mockApi, setMockCourses } from "../src/lib/api.mock";

test("enrolment questions list only selected courses before building", async () => {
  setMockCourses(["PSYC 1010"]);
  for (const text of [
    "What classes am I enrolled in",
    "Which units am I taking?",
    "What courses am I registered for?",
    "Show my courses",
  ]) {
    const result = await mockApi.parse(text);
    assert.deepEqual(result.rules, []);
    assert.ok(!result.ready_to_build);
    assert.match(result.message.text, /PSYC 1010/);
    assert.doesNotMatch(result.message.text, /STAT 2010|couldn't/);
    assert.match(result.message.note ?? "", /not confirmation/);
  }
});

test("asking about enrolled classes leaves the draft and preferences unchanged", async () => {
  setMockCourses(["PSYC 1010", "PHIL 1100"]);
  await mockApi.getContext();
  const plan = await mockApi.solve([]);
  const result = await mockApi.adjust(
    plan.plan_id,
    "What classes am I enrolled in?",
  );
  assert.equal(result.changed, false);
  assert.equal(result.plan_id, plan.plan_id);
  assert.equal(result.version, plan.version);
  assert.deepEqual(result.rules, plan.rules);
  assert.deepEqual(result.sections, plan.sections);
  assert.match(result.message.text, /PHIL 1100/);
  assert.match(result.message.text, /sample draft/);
  assert.doesNotMatch(result.message.text, /STAT 2010/);
});
