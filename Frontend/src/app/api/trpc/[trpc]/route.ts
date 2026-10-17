import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { rejectUnsafeRequest } from "@/trpc/http";
import { createTRPCContext } from "@/trpc/init";
import { appRouter } from "@/trpc/routers/_app";

const handler = async (req: Request) => {
  const rejected = rejectUnsafeRequest(req);
  if (rejected) return rejected;

  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    maxBatchSize: 10,
    createContext: createTRPCContext,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
};

export { handler as GET, handler as POST };
