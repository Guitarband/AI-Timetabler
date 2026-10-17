import type { ConversationMessage } from "./enrolment-contract";
import type { ChatItem } from "./reducer";

/** Only the active timetable's recent conversation is sent, before appending the new turn. */
export function conversationContext(items: ChatItem[]): ConversationMessage[] {
  const history: ConversationMessage[] = [];
  let remaining = 24_000;
  for (
    let index = items.length - 1;
    index >= 0 && history.length < 12;
    index--
  ) {
    const item = items[index];
    if (item.role === "rules" || (item.role === "ai" && item.error)) continue;
    const content = (
      item.role === "user"
        ? item.text
        : [item.message.text, ...item.message.steps, item.message.note]
            .filter(Boolean)
            .join("\n")
    )
      .trim()
      .slice(0, 4000);
    if (!content) continue;
    if (content.length > remaining) break;
    history.unshift({
      role: item.role === "user" ? "user" : "assistant",
      content,
    });
    remaining -= content.length;
  }
  return history;
}
