import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { isAuthEmailConfigured, sendAuthEmail } from "@/lib/auth-email";
import { requiresEmailVerification } from "@/lib/auth-policy";
import { isMonashEmail } from "@/lib/monash-email";
import prisma from "@/lib/prisma";
import { isStudentId } from "@/lib/student-id";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  rateLimit: { enabled: true },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!isMonashEmail(user.email)) return false;
          const studentId = "studentId" in user ? user.studentId : undefined;
          const student = user.email
            .toLowerCase()
            .endsWith("@student.monash.edu");
          if (student ? !isStudentId(studentId) : studentId != null)
            return false;
          return { data: { ...user, email: user.email.trim().toLowerCase() } };
        },
      },
      update: {
        before: async (data) => {
          if (Object.hasOwn(data, "studentId")) return false;
          if (typeof data.email === "string" && !isMonashEmail(data.email)) {
            return false;
          }
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: requiresEmailVerification(),
    minPasswordLength: 8,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Reset your timetable account password",
        text: `Open this link to reset your password: ${url}`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: requiresEmailVerification(),
    sendOnSignIn: requiresEmailVerification(),
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Verify your timetable account",
        text: `Open this link to verify your Monash email: ${url}`,
      });
    },
  },
  user: {
    additionalFields: {
      studentId: {
        type: "string",
        required: false,
        input: true,
        returned: false,
      },
    },
    validateUserInfo: ({ user, source }) => {
      if (!user.email || !isMonashEmail(user.email)) {
        return {
          error: "email_domain_not_allowed",
          errorDescription:
            "Use a @monash.edu or @student.monash.edu email address.",
        };
      }

      if (source.action !== "create-user") return;

      const studentId = user.studentId;
      const isStudent = user.email
        .toLowerCase()
        .endsWith("@student.monash.edu");
      if (
        (isStudent && !isStudentId(studentId)) ||
        (!isStudent && studentId != null)
      ) {
        return {
          error: "invalid_student_id",
          errorDescription:
            "A student ID is required for student accounts only.",
        };
      }

      if (requiresEmailVerification() && !isAuthEmailConfigured()) {
        return {
          error: "email_delivery_unavailable",
          errorDescription: "Account registration is temporarily unavailable.",
        };
      }
    },
  },
});
