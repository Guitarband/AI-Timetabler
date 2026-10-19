import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isAuthEmailConfigured } from "@/lib/auth-email";
import { isEligibleUser, requiresEmailVerification } from "@/lib/auth-policy";
import { requestAuth } from "@/lib/auth-request";
import { isMonashEmail } from "@/lib/monash-email";
import { isStudentId } from "@/lib/student-id";
import { createTRPCRouter, publicProcedure } from "../init";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email())
  .refine(isMonashEmail, "Use a Monash email address.");
const signUpInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    email,
    password: z.string().min(8).max(128),
    studentId: z.string().refine(isStudentId).optional(),
  })
  .superRefine((value, ctx) => {
    const student = value.email.endsWith("@student.monash.edu");
    if (student !== !!value.studentId) {
      ctx.addIssue({
        code: "custom",
        path: ["studentId"],
        message: student
          ? "Enter your student ID."
          : "Staff accounts do not need a student ID.",
      });
    }
  });
function requireEmailDelivery() {
  if (!isAuthEmailConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Account email delivery is not configured. Try again later.",
    });
  }
}

export const authRouter = createTRPCRouter({
  session: publicProcedure.query(({ ctx }) => {
    const user = ctx.session?.user;
    if (!isEligibleUser(user)) {
      return { signedIn: false as const, user: null };
    }
    return {
      signedIn: true as const,
      user: { id: user.id, name: user.name, email: user.email },
    };
  }),
  signUp: publicProcedure
    .input(signUpInput)
    .mutation(async ({ ctx, input }) => {
      if (requiresEmailVerification()) requireEmailDelivery();
      await requestAuth(
        ctx,
        "sign-up/email",
        { ...input, callbackURL: "/login" },
        "Account creation failed. Check your details and try again.",
      );
      return {
        submitted: true,
        verificationRequired: requiresEmailVerification(),
      };
    }),
  signIn: publicProcedure
    .input(z.object({ email, password: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      await requestAuth(
        ctx,
        "sign-in/email",
        input,
        "Sign in failed. Check your email and password.",
      );
      return { signedIn: true };
    }),
  // An expired or newly ineligible account must still be able to clear cookies.
  signOut: publicProcedure.mutation(async ({ ctx }) => {
    await requestAuth(ctx, "sign-out", {}, "Sign out failed. Try again.");
    return { signedOut: true };
  }),
  resendVerification: publicProcedure
    .input(z.object({ email }))
    .mutation(async ({ ctx, input }) => {
      requireEmailDelivery();
      await requestAuth(
        ctx,
        "send-verification-email",
        { ...input, callbackURL: "/login" },
        "Verification email could not be sent.",
      );
      return { submitted: true };
    }),
  requestPasswordReset: publicProcedure
    .input(z.object({ email }))
    .mutation(async ({ ctx, input }) => {
      requireEmailDelivery();
      await requestAuth(
        ctx,
        "request-password-reset",
        { ...input, redirectTo: "/reset-password" },
        "Password reset could not be requested. Try again.",
      );
      return { submitted: true };
    }),
  resetPassword: publicProcedure
    .input(
      z.object({
        token: z.string().min(1).max(2048),
        newPassword: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requestAuth(
        ctx,
        "reset-password",
        input,
        "This reset link is invalid or expired. Request a new one.",
      );
      return { reset: true };
    }),
});
