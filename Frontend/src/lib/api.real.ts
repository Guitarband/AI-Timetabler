import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@/trpc/routers/_app";
import type { EnrolmentApi } from "./api";

// Same-origin cookies reach tRPC; only the server forwards the verified identity.
const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      fetch: (url, options) =>
        fetch(url, { ...options, credentials: "same-origin" }),
    }),
  ],
});
export const realApi: EnrolmentApi = {
  ruleChange: (plan_id, token, accept) =>
    client.enrolment.ruleChange.mutate({ plan_id, token, accept }),
  alternatives: (plan_id, section_key) =>
    client.enrolment.alternatives.mutate({ plan_id, section_key }),
  keep: (plan_id, section_key, keep) =>
    client.enrolment.keep.mutate({ plan_id, section_key, keep }),
  swap: (plan_id, from_key, to_key) =>
    client.enrolment.swap.mutate({ plan_id, from_key, to_key }),
  getContext: () => client.enrolment.context.query(),
  parse: (text, history) => client.enrolment.parse.mutate({ text, history }),
  solve: (rules) => client.enrolment.solve.mutate({ rules }),
  adjust: (plan_id, text, history) =>
    client.enrolment.adjust.mutate({ plan_id, text, history }),
  confirm: (plan_id) => client.enrolment.confirm.mutate({ plan_id }),
};
