import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@/trpc/routers/_app";

const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});
export const coursesApi = {
  catalogue: (accountId: string) =>
    client.courses.catalogue.query({ accountId }),
  save: (accountId: string, termId: string, codes: string[]) =>
    client.courses.save.mutate({ accountId, termId, codes }),
};
