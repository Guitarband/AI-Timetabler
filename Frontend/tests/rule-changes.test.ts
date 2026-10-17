import assert from "node:assert/strict";
import { test } from "node:test";
import { mockApi } from "../src/lib/api.mock";
import type { RuleChangeProposal } from "../src/lib/enrolment-contract";
import { initialState, reducer } from "../src/lib/reducer";
import { snapshotOf, snapshotSchema } from "../src/lib/saved-timetables";

test("rule proposals persist, preserve the draft and remember a decision after reload", async () => {
  const context = await mockApi.getContext();
  const plan = await mockApi.solve([]);
  const old = {
    id: "old",
    kind: "earliest",
    value: 600,
    label: "No classes before 10:00",
    source: "after 10",
  };
  const proposal: RuleChangeProposal = {
    token: "signed-proposal",
    plan_id: plan.plan_id,
    remove: [old],
    add: [{ ...old, id: "new", value: 540, label: "No classes before 09:00" }],
    reasons: ["These rules set different start limits."],
  };
  const message = {
    steps: [],
    text: "Review this change",
    rule_change: proposal,
  };
  let state = reducer(initialState, { type: "NEW_TIMETABLE", context });
  state = reducer(state, { type: "PLAN_RECEIVED", plan });
  state = reducer(state, { type: "SET_PHASE", phase: "adjust" });
  state = reducer(state, {
    type: "PLAN_RECEIVED",
    plan: { ...plan, changed: false, message },
  });
  assert.deepEqual(state.plan, plan);
  state = reducer(state, { type: "AI_SAID", message });
  state = reducer(initialState, {
    type: "OPEN_TIMETABLE",
    snapshot: snapshotSchema.parse(
      JSON.parse(JSON.stringify(snapshotOf(state))),
    ),
  });
  const pending = state.items.at(-1);
  assert.ok(pending?.role === "ai");
  assert.deepEqual(pending.message.rule_change, proposal);
  state = reducer(state, {
    type: "RULE_CHANGE_RESOLVED",
    token: proposal.token,
    status: "declined",
  });
  const saved = snapshotSchema.parse(
    JSON.parse(JSON.stringify(snapshotOf(state))),
  );
  const resolved = saved.items.at(-1);
  assert.ok(resolved?.role === "ai");
  assert.equal(resolved.message.rule_change?.status, "declined");
  assert.deepEqual(saved.plan, JSON.parse(JSON.stringify(plan)));
});
