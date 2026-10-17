import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isMonashEmail } from "@/lib/monash-email";
import { authenticatedProcedure, createTRPCRouter } from "../init";

export const friendsRouter = createTRPCRouter({
  list: authenticatedProcedure.query(async ({ ctx }) => {
    const friendships = await ctx.prisma.friendship.findMany({
      where: {
        OR: [{ userAId: ctx.user.id }, { userBId: ctx.user.id }],
      },
      include: {
        userA: { select: { id: true, name: true, email: true } },
        userB: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return friendships.map((friendship) => ({
      id: friendship.id,
      status: friendship.status,
      direction:
        friendship.requestedById === ctx.user.id ? "outgoing" : "incoming",
      user:
        friendship.userAId === ctx.user.id
          ? friendship.userB
          : friendship.userA,
      createdAt: friendship.createdAt,
    }));
  }),
  request: authenticatedProcedure
    .input(
      z.object({
        email: z.email().refine(isMonashEmail, "Use a Monash email address."),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      if (email === ctx.user.email.toLowerCase()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot add yourself as a friend.",
        });
      }

      const target = await ctx.prisma.user.findFirst({
        where: {
          email: { equals: email, mode: "insensitive" },
          emailVerified: true,
        },
        select: { id: true },
      });

      if (!target) return { submitted: true };

      const [userAId, userBId] = [ctx.user.id, target.id].sort();
      try {
        await ctx.prisma.friendship.create({
          data: {
            userAId,
            userBId,
            requestedById: ctx.user.id,
          },
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
    .input(
      z.object({
        id: z.string().min(1),
        action: z.enum(["accept", "decline"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.friendship.updateMany({
        where: {
          id: input.id,
          status: "PENDING",
          requestedById: { not: ctx.user.id },
          OR: [{ userAId: ctx.user.id }, { userBId: ctx.user.id }],
        },
        data: {
          status: input.action === "accept" ? "ACCEPTED" : "DECLINED",
        },
      });

      if (result.count === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return { updated: true };
    }),
  remove: authenticatedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.friendship.deleteMany({
        where: {
          id: input.id,
          OR: [{ userAId: ctx.user.id }, { userBId: ctx.user.id }],
        },
      });

      return { removed: result.count > 0 };
    }),
});
