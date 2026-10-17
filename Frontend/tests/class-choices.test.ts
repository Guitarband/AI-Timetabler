import assert from "node:assert/strict";
import { test } from "node:test";
import { mockApi, restoreMockPlan } from "../src/lib/api.mock";
import { initialState, reducer } from "../src/lib/reducer";
import { snapshotOf, snapshotSchema } from "../src/lib/saved-timetables";

test("plain allocation requests build with no optional rules and survive reload", async () => {
  const context = await mockApi.getContext();
  const response = await mockApi.parse(
    "Fill in my timetable to allocate all my units with no clashes",
  );
  assert.equal(response.ready_to_build, true);
  assert.deepEqual(response.rules, []);
  let state = reducer(initialState, { type: "NEW_TIMETABLE", context });
  state = reducer(state, {
    type: "RULES_PARSED",
    rules: [],
    readyToBuild: response.ready_to_build,
  });
  assert.equal(state.phase, "confirm");
  const snapshot = snapshotSchema.parse(
    JSON.parse(JSON.stringify(snapshotOf(state))),
  );
  assert.equal(
    reducer(initialState, { type: "OPEN_TIMETABLE", snapshot }).phase,
    "confirm",
  );
  const plan = await mockApi.solve([]);
  assert.equal(plan.sections.length, 8);
  assert.equal(plan.match_pct, 100);
  for (const a of plan.sections)
    for (const b of plan.sections) {
      if (a.key !== b.key && a.day === b.day)
        assert.ok(a.start >= b.end || b.start >= a.end);
    }
});

test("mock direct swaps, saved pins and AI adjustments share the same protection", async () => {
  const context = await mockApi.getContext();
  const plan = await mockApi.solve([]);
  const options = await mockApi.alternatives(plan.plan_id, "phil-s02");
  assert.equal(options.options[0].remaining_seats, null);
  const kept = await mockApi.keep(plan.plan_id, "phil-s02", true);
  let state = reducer(initialState, { type: "NEW_TIMETABLE", context });
  state = reducer(state, { type: "PLAN_RECEIVED", plan: kept });
  const snapshot = snapshotSchema.parse(
    JSON.parse(JSON.stringify(snapshotOf(state))),
  );
  assert.deepEqual(snapshot.plan?.kept_sections, ["phil-s02"]);
  restoreMockPlan(snapshot.plan);
  assert.equal(
    (await mockApi.swap(kept.plan_id, "phil-s02", "phil-s01")).changed,
    false,
  );
  assert.equal(
    (await mockApi.adjust(kept.plan_id, "Move my seminar")).changed,
    false,
  );
  const released = await mockApi.keep(kept.plan_id, "phil-s02", false);
  const swapped = await mockApi.swap(released.plan_id, "phil-s02", "phil-s01");
  assert.deepEqual(
    swapped.sections.filter((s) => s.key !== "phil-s01").map((s) => s.key),
    plan.sections.filter((s) => s.key !== "phil-s02").map((s) => s.key),
  );
  await assert.rejects(
    mockApi.keep(plan.plan_id, "phil-s01", true),
    /latest timetable/,
  );
});
