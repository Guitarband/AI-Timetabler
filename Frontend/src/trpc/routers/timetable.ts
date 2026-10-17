import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { requestTimetableCalculation } from "@/lib/timetable-backend";
import { authenticatedProcedure, createTRPCRouter } from "../init";

export const timetableRouter = createTRPCRouter({
  viewPeer: authenticatedProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const grant = await ctx.prisma.peerDataRequest.findUnique({
        where: {
          requesterId_recipientId: {
            requesterId: ctx.user.id,
            recipientId: input.userId,
          },
        },
        select: { status: true },
      });

      if (grant?.status !== "ACCEPTED" && grant?.status !== "PARTIAL") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return {};
    }),
  calculate: authenticatedProcedure.mutation(({ ctx }) =>
    requestTimetableCalculation(ctx.user.id),
  ),
});
