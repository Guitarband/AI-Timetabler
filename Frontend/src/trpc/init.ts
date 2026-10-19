import { initTRPC, TRPCError } from "@trpc/server";
import { auth } from "@/lib/auth";
import { forwardAuthCookies } from "@/lib/auth-cookies";
import { isEligibleUser } from "@/lib/auth-policy";
import prisma from "@/lib/prisma";

type ContextOptions = { req: Request; resHeaders?: Headers };

// Only HTTP responses can forward refreshed or cleared cookies to the browser.
export async function createTRPCContext({ req, resHeaders }: ContextOptions) {
  const result = await auth.api.getSession({
    headers: req.headers,
    returnHeaders: true,
    query: {
      disableCookieCache: true,
      ...(resHeaders ? {} : { disableRefresh: true }),
    },
  });
  if (resHeaders) forwardAuthCookies(result.headers, resHeaders);
  return {
    prisma,
    session: result.response,
    requestHeaders: req.headers,
    requestUrl: req.url,
    responseHeaders: resHeaders ?? new Headers(),
    canSetCookies: !!resHeaders,
  };
}

const t = initTRPC
  .context<Awaited<ReturnType<typeof createTRPCContext>>>()
  .create();
export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const baseProcedure = t.procedure.use(({ ctx, type, next }) => {
  if (type === "mutation" && !ctx.canSetCookies) {
    throw new TRPCError({
      code: "METHOD_NOT_SUPPORTED",
      message: "Use the HTTP API for mutations.",
    });
  }
  return next();
});
export const publicProcedure = baseProcedure;
export const authenticatedProcedure = baseProcedure.use(({ ctx, next }) => {
  const session = ctx.session;
  const user = session?.user;
  if (!isEligibleUser(user)) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in with an eligible Monash account to continue.",
    });
  }
  // Preserve ctx.auth; derive identities exclusively from the authenticated session.
  return next({ ctx: { ...ctx, auth: session, user, userId: user.id } });
});
