import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionBlock } from "../src/components/timetable/SectionBlock";
import { TimetablePanel } from "../src/components/timetable/TimetablePanel";
import {
  addSuggestions,
  invalidFriendRules,
  newRule,
  remainingFriends,
} from "../src/lib/rules";
import type { Plan, Section } from "../src/lib/types";

const names = ["Maya Okafor", "Leo Chen"];
const section: Section = {
  key: "one",
  code: "WRIT 1000",
  title: "Writing",
  kind: "Workshop",
  section: "W-03",
  day: 3,
  start: "11:30",
  end: "13:00",
  room: "Studio",
  credits: 3,
  with_friend: true,
  changed: false,
  shared_with: [names[1]],
};

test("another friend is offered without duplicating the first selection", () => {
  const first = newRule("friend", names);
  assert.ok(addSuggestions([first], names).includes("friend"));
  assert.deepEqual(remainingFriends([first], names), [names[1]]);
  const second = newRule("friend", remainingFriends([first], names));
  assert.equal(second.value, names[1]);
  assert.equal(invalidFriendRules([first, second]), false);
  assert.ok(!addSuggestions([first, second], names).includes("friend"));
  assert.equal(
    invalidFriendRules([first, { ...second, value: " maya okafor " }]),
    true,
  );
  assert.equal(invalidFriendRules([{ ...first, value: " " }]), true);
});

test("class labels identify actual friends, including shared and changed sections", () => {
  function render(value: Section) {
    return renderToStaticMarkup(
      createElement(SectionBlock, {
        section: value,
        gridStartMin: 480,
        friendFirst: "Maya",
        index: 0,
      }),
    );
  }
  assert.match(render(section), /Leo Chen/);
  assert.doesNotMatch(render(section), /Maya/);
  const both = render({ ...section, shared_with: names, changed: true });
  assert.match(both, /Maya Okafor, Leo Chen/);
  assert.match(both, /Just changed/i);
  assert.doesNotMatch(render({ ...section, shared_with: [] }), /With Maya/i);
  assert.match(render({ ...section, shared_with: undefined }), /Maya/);
});

test("timetable displays both match summaries and supports older single-friend plans", () => {
  const friends = names.map((name, i) => ({
    name,
    shared: i + 2,
    total: 3,
    text: `${name}: ${i + 2} of 3 shared classes`,
  }));
  const plan: Plan = {
    plan_id: "test",
    version: 1,
    changed: true,
    rules: names.map((name) => newRule("friend", [name])),
    sections: [section],
    match_pct: 83,
    scores: [],
    friends,
    friend: friends[0],
    summary: { sections: 1, credits: 3, hold_minutes: 0 },
    message: { text: "Draft", steps: [] },
  };
  function render(value: Plan) {
    return renderToStaticMarkup(
      createElement(TimetablePanel, {
        phase: "adjust",
        plan: value,
        prevMatch: null,
        rules: value.rules,
        context: null,
        confirmation: null,
        busy: false,
        onAsk: () => {},
        onConfirm: () => {},
      }),
    );
  }
  const markup = render(plan);
  assert.match(markup, /Maya Okafor: 2 of 3/);
  assert.match(markup, /Leo Chen: 3 of 3/);
  // The readable list outside the calendar must attribute classes to the right person.
  assert.match(markup, /aria-label="Classes shared with Leo Chen"/);
  assert.doesNotMatch(markup, /aria-label="Classes shared with Maya Okafor"/);
  assert.match(markup, /WRIT 1000.*Workshop.*W-03.*WED.*11:30/);
  assert.match(render({ ...plan, friends: undefined }), /Maya Okafor: 2 of 3/);
});
