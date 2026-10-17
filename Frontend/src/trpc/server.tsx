import "server-only";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { headers } from "next/headers";
import { cache } from "react";
import { createCallerFactory, createTRPCContext } from "./init";
import { makeQueryClient } from "./query-client";
import { appRouter } from "./routers/_app";

export const getQueryClient = cache(makeQueryClient);
export const getServerContext = cache(async () =>
  createTRPCContext({
    req: new Request(
      new URL(
        "/api/trpc",
        process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
      ),
      {
        headers: await headers(),
      },
    ),
  }),
);
export const trpc = createTRPCOptionsProxy({
  ctx: getServerContext,
  router: appRouter,
  queryClient: getQueryClient,
});
export const getServerCaller = cache(async () =>
  createCallerFactory(appRouter)(await getServerContext()),
);
