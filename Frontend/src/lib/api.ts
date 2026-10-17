/**
 * The ONLY entry point components use to talk to the backend.
 * Components must never call fetch() themselves (brief section 8).
 *
 * Two implementations share one interface:
 *   - api.real.ts  calls protected, same-origin tRPC procedures
 *   - api.mock.ts  replays the prototype data and copy, no network
 * Switch with NEXT_PUBLIC_USE_MOCK=true|false. No code change needed.
 */

import { withScenario } from "@/dev/scenarios"; // DEV-ONLY (mock scenarios): delete this line when removing src/dev/
import { mockApi, restoreMockPlan } from "./api.mock";
import { realApi } from "./api.real";
import { config } from "./config";
import type {
  ClassAlternatives,
  ConversationMessage,
} from "./enrolment-contract";
import type { Confirmation, Context, ParseResponse, Plan, Rule } from "./types";

export interface EnrolmentApi {
  alternatives(planId: string, sectionKey: string): Promise<ClassAlternatives>;
  keep(planId: string, sectionKey: string, keep: boolean): Promise<Plan>;
  swap(planId: string, fromKey: string, toKey: string): Promise<Plan>;
  /** GET /context, on page load. */
  getContext(): Promise<Context>;
  /** POST /parse { text }, when the user presses Send in `intake`. */
  parse(text: string, history?: ConversationMessage[]): Promise<ParseResponse>;
  /** POST /solve { rules }, when the user presses the build button. */
  solve(rules: Rule[]): Promise<Plan>;
  /** POST /adjust { plan_id, text }, when the user sends a request in `adjust`. */
  adjust(
    planId: string,
    text: string,
    history?: ConversationMessage[],
  ): Promise<Plan>;
  /** POST /confirm { plan_id }, when the user presses Confirm enrolment. */
  confirm(planId: string): Promise<Confirmation>;
}

export { ApiError } from "./errors";

// DEV-ONLY: when removing src/dev/, change `withScenario(mockApi)` back to `mockApi`.
export const api: EnrolmentApi = config.useMock
  ? withScenario(mockApi)
  : realApi;
export const apiMode = config.useMock ? "mock" : "real";

export function restorePlanner(plan: Plan | null) {
  if (config.useMock) restoreMockPlan(plan);
}
