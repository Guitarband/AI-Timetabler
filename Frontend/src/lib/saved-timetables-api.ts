import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@/trpc/routers/_app";

// Persistence always uses PostgreSQL, including when the solver uses demo data.
const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      fetch: (url, options) =>
        fetch(url, { ...options, credentials: "same-origin" }),
    }),
  ],
});
export const savedTimetablesApi = client.savedTimetables;
