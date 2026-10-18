import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { ClassAlternatives } from "@/lib/enrolment-contract";
import { personalizeContext } from "@/lib/session-profile";
import type { Confirmation, Context, ParseResponse, Plan } from "@/lib/types";
import { authenticatedProcedure, createTRPCRouter } from "../init";

/** The backend must authenticate this service and scope plan IDs to X-User-Id. */
async function request<T>(
  operation: string,
  user: { id: string; name: string },
  body?: unknown,
): Promise<T> {
  const address = process.env.ENROLMENT_BACKEND_URL;
  const token = process.env.TIMETABLE_BACKEND_TOKEN;
  if (!address || !token) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The enrolment backend is not configured.",
    });
  }
  let url: URL;
  try {
    url = new URL(`${address.replace(/\/$/, "")}/${operation}`);
    const local =
      process.env.NODE_ENV === "development" &&
      ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
      throw new Error("HTTPS required");
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The enrolment backend URL is invalid.",
    });
  }
  try {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-User-Id": user.id,
        "X-User-Name": encodeURIComponent(user.name),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const codes = {
        400: "BAD_REQUEST",
        404: "NOT_FOUND",
        409: "CONFLICT",
        422: "BAD_REQUEST",
        429: "TOO_MANY_REQUESTS",
        503: "SERVICE_UNAVAILABLE",
        504: "TIMEOUT",
      } as const;
      const code = codes[response.status as keyof typeof codes];
      const payload = await response.json().catch(() => null);
      if (code && typeof payload?.detail === "string") {
        throw new TRPCError({ code, message: payload.detail.slice(0, 500) });
      }
      throw new Error("Backend request failed");
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "The enrolment backend is unavailable. Try again.",
    });
  }
}

const text = z.string().trim().min(1).max(10_000);
const planId = z.string().min(1).max(200);
const history = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1).max(4000),
    }),
  )
  .max(12)
  .refine(
    (messages) =>
      messages.reduce(
        (length, message) => length + message.content.length,
        0,
      ) <= 24_000,
    "Conversation context is too long.",
  )
  .optional();
export const enrolmentRouter = createTRPCRouter({
  reopen: authenticatedProcedure
    .input(z.object({ plan_id: planId }))
    .mutation(({ ctx, input }) => request<Plan>("reopen", ctx.user, input)),
  ruleChange: authenticatedProcedure
    .input(
      z.object({
        plan_id: planId,
        token: z.string().min(1).max(100_000),
        accept: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      request<Plan>("rule-change", ctx.user, input),
    ),
  alternatives: authenticatedProcedure
    .input(z.object({ plan_id: planId, section_key: planId }))
    .mutation(({ ctx, input }) =>
      request<ClassAlternatives>("alternatives", ctx.user, input),
    ),
  keep: authenticatedProcedure
    .input(
      z.object({ plan_id: planId, section_key: planId, keep: z.boolean() }),
    )
    .mutation(({ ctx, input }) => request<Plan>("keep", ctx.user, input)),
  swap: authenticatedProcedure
    .input(z.object({ plan_id: planId, from_key: planId, to_key: planId }))
    .mutation(({ ctx, input }) => request<Plan>("swap", ctx.user, input)),
  context: authenticatedProcedure.query(async ({ ctx }) =>
    personalizeContext(
      await request<Context>("context", ctx.user),
      ctx.user.name,
    ),
  ),
  parse: authenticatedProcedure
    .input(z.object({ text, history }))
    .mutation(({ ctx, input }) =>
      request<ParseResponse>("parse", ctx.user, input),
    ),
  solve: authenticatedProcedure
    .input(
      z.object({
        rules: z
          .array(
            z.object({
              id: z.string().min(1).max(200),
              kind: z.string().min(1).max(100),
              value: z.union([z.number().finite(), z.string().max(200)]),
              label: z.string().max(1000),
              source: z.string().max(10_000),
            }),
          )
          .max(100),
      }),
    )
    .mutation(({ ctx, input }) => request<Plan>("solve", ctx.user, input)),
  adjust: authenticatedProcedure
    .input(z.object({ plan_id: planId, text, history }))
    .mutation(({ ctx, input }) => request<Plan>("adjust", ctx.user, input)),
  confirm: authenticatedProcedure
    .input(z.object({ plan_id: planId }))
    .mutation(({ ctx, input }) =>
      request<Confirmation>("confirm", ctx.user, input),
    ),
});
