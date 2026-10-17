import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState, isBusy, reducer, type State } from "../src/lib/reducer";
import type { Plan } from "../src/lib/types";

test("a read-only answer appears in chat without replacing the timetable or match history", () => {
  const plan: Plan = {
    plan_id: "current",
    version: 3,
    changed: true,
    rules: [],
    sections: [],
    scores: [],
    match_pct: 89,
    summary: { sections: 0, credits: 0, hold_minutes: 0 },
    message: { text: "Draft", steps: [] },
  };
  const answer = { text: "Maya Okafor: 2 matching classes.", steps: [] };
  let state: State = { ...initialState, plan, prevMatch: 83 };
  state = reducer(state, {
    type: "PLAN_RECEIVED",
    plan: { ...plan, changed: false, message: answer },
  });
  state = reducer(state, { type: "AI_SAID", message: answer });
  assert.equal(state.plan, plan);
  assert.equal(state.prevMatch, 83);
  assert.equal(state.items.at(-1)?.role, "ai");
  assert.ok(JSON.stringify(state.items).includes(answer.text));
});

test("empty interpretation returns to editable intake and the next valid attempt can build", () => {
  let state = reducer(initialState, { type: "SET_PHASE", phase: "thinking" });
  state = reducer(state, { type: "RULES_PARSED", rules: [] });
  state = reducer(state, { type: "SET_DRAFT", text: "purple elephants" });
  assert.equal(state.phase, "intake");
  assert.equal(isBusy(state.phase), false);
  assert.equal(state.draft, "purple elephants");
  assert.equal(
    state.items.some((item) => item.role === "rules"),
    false,
  );

  state = reducer(state, { type: "USER_SAID", text: "Keep Fridays free" });
  state = reducer(state, { type: "SET_PHASE", phase: "thinking" });
  state = reducer(state, {
    type: "RULES_PARSED",
    rules: [
      {
        id: "r",
        kind: "dayoff",
        value: 5,
        label: "Fridays free",
        source: "Keep Fridays free",
      },
    ],
  });
  assert.equal(state.phase, "confirm");
  assert.equal(state.rules.length, 1);
  assert.equal(state.items.filter((item) => item.role === "rules").length, 1);
});
