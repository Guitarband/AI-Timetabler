import { TRPCError } from "@trpc/server";
import { auth } from "./auth";
import { forwardAuthCookies } from "./auth-cookies";

type AuthEndpoint =
  | "sign-up/email"
  | "sign-in/email"
  | "sign-out"
  | "send-verification-email"
  | "request-password-reset"
  | "reset-password";
type AuthRequestContext = {
  requestHeaders: Headers;
  requestUrl: string;
  responseHeaders: Headers;
};

// Keep Better Auth's HTTP rate limiter and middleware active through tRPC,
// including each individual account operation inside a batch.
export async function requestAuth(
  ctx: AuthRequestContext,
  endpoint: AuthEndpoint,
  body: unknown,
  failureMessage: string,
) {
  const requestHeaders = new Headers(ctx.requestHeaders);
  requestHeaders.set("Content-Type", "application/json");
  requestHeaders.delete("content-length");
  const response = await auth.handler(
    new Request(new URL(`/api/auth/${endpoint}`, ctx.requestUrl), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    }),
  );
  forwardAuthCookies(response.headers, ctx.responseHeaders);
  if (!response.ok) {
    if (response.status === 429) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many attempts. Wait before trying again.",
      });
    }
    if (response.status >= 500) {
      // Keep credentials and provider response bodies out of production logs.
      console.error(`[auth] ${endpoint} returned HTTP ${response.status}`);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Account service is temporarily unavailable. Try again later.",
      });
    }
    throw new TRPCError({
      code: endpoint === "sign-in/email" ? "UNAUTHORIZED" : "BAD_REQUEST",
      message: failureMessage,
    });
  }
  // Never return Better Auth's session token or full user record to components.
}
