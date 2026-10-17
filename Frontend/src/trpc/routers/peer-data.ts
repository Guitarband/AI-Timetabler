import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isMonashEmail } from "@/lib/monash-email";
import { isStudentId } from "@/lib/student-id";
import { authenticatedProcedure, createTRPCRouter } from "../init";

const decision = z.enum(["ACCEPTED", "PARTIAL", "DENIED"]);
const studentLookup = z.object({
  studentId: z.string().refine(isStudentId, "Enter a valid student ID."),
});

function isVerifiedStudent<T extends { email: string; emailVerified: boolean }>(
  user: T | null,
): user is T {
  return (
    !!user?.emailVerified &&
    isMonashEmail(user.email) &&
    user.email.toLowerCase().endsWith("@student.monash.edu")
  );
}

export const peerDataRouter = createTRPCRouter({
  list: authenticatedProcedure.query(async ({ ctx }) => {
    const requests = await ctx.prisma.peerDataRequest.findMany({
      where: {
        OR: [{ requesterId: ctx.user.id }, { recipientId: ctx.user.id }],
      },
      include: {
        requester: { select: { id: true, name: true } },
        recipient: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return requests.map((request) => {
      const outgoing = request.requesterId === ctx.user.id;
      const other = outgoing ? request.recipient : request.requester;
      return {
        id: request.id,
        status: request.status,
        direction: outgoing ? "outgoing" : "incoming",
        user: { id: other.id, name: other.name },
        createdAt: request.createdAt,
        respondedAt: request.respondedAt,
      };
    });
  }),
  lookup: authenticatedProcedure
    .input(studentLookup)
    .query(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { studentId: input.studentId },
        select: { id: true, name: true, email: true, emailVerified: true },
      });

      return isVerifiedStudent(user) ? { id: user.id, name: user.name } : null;
    }),
  request: authenticatedProcedure
    .input(studentLookup)
    .mutation(async ({ ctx, input }) => {
      const recipient = await ctx.prisma.user.findUnique({
        where: { studentId: input.studentId },
        select: { id: true, email: true, emailVerified: true },
      });

      if (!isVerifiedStudent(recipient)) {
        return { submitted: true };
      }
      if (recipient.id === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot request your own timetable.",
        });
      }

      try {
        await ctx.prisma.peerDataRequest.create({
          data: { requesterId: ctx.user.id, recipientId: recipient.id },
        });
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "P2002"
        ) {
          throw error;
        }
      }

      return { submitted: true };
    }),
  respond: authenticatedProcedure
    .input(z.object({ id: z.string().min(1), decision }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.peerDataRequest.updateMany({
        where: {
          id: input.id,
          recipientId: ctx.user.id,
          status: "PENDING",
        },
        data: { status: input.decision, respondedAt: new Date() },
      });
      if (result.count === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { status: input.decision };
    }),
  changeAccess: authenticatedProcedure
    .input(z.object({ id: z.string().min(1), decision }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.peerDataRequest.updateMany({
        where: {
          id: input.id,
          recipientId: ctx.user.id,
          status: { not: "PENDING" },
        },
        data: { status: input.decision, respondedAt: new Date() },
      });
      if (result.count === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { status: input.decision };
    }),
  cancel: authenticatedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.peerDataRequest.deleteMany({
        where: {
          id: input.id,
          requesterId: ctx.user.id,
        },
      });
      return { cancelled: result.count > 0 };
    }),
});
