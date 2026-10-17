import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationContext } from "../src/lib/conversation-context";
import { type ChatItem, initialState, reducer } from "../src/lib/reducer";

test("context preserves recent dialogue and actual clarification options in chronological order", () => {
  const items: ChatItem[] = [
    { id: "a", role: "user", text: "Move my Monday lecture" },
    {
      id: "b",
      role: "ai",
      message: {
        text: "Which lecture?",
        steps: ["IT102 at 9am", "IT103 at 11am"],
      },
      animate: false,
    },
    { id: "c", role: "rules" },
    {
      id: "d",
      role: "ai",
      message: { text: "Temporary error", steps: [] },
      animate: false,
      error: true,
    },
  ];
  assert.deepEqual(conversationContext(items), [
    { role: "user", content: "Move my Monday lecture" },
    {
      role: "assistant",
      content: "Which lecture?\nIT102 at 9am\nIT103 at 11am",
    },
  ]);
  assert.equal(items.length, 4);
});

test("context is bounded and a new timetable cannot inherit the old conversation", () => {
  const items: ChatItem[] = Array.from({ length: 30 }, (_, index) => ({
    id: String(index),
    role: "user",
    text: `${index}: ${"x".repeat(5000)}`,
  }));
  const context = conversationContext(items);
  assert.ok(context.length <= 12);
  assert.ok(context.every((message) => message.content.length <= 4000));
  assert.ok(
    context.reduce((sum, message) => sum + message.content.length, 0) <= 24000,
  );
  assert.match(context.at(-1)?.content ?? "", /^29:/);
  const fresh = reducer(
    { ...initialState, items },
    {
      type: "NEW_TIMETABLE",
      context: {
        student_name: "Test",
        term: "Test",
        approved_courses: 1,
        published_sections: 2,
        friends: [],
        greeting: { text: "New timetable", steps: [] },
      },
    },
  );
  assert.deepEqual(conversationContext(fresh.items), [
    { role: "assistant", content: "New timetable" },
  ]);
});
