import { authenticatedProcedure, createTRPCRouter } from "../init";

export const profileRouter = createTRPCRouter({
  me: authenticatedProcedure.query(({ ctx }) => ({
    id: ctx.user.id,
    name: ctx.user.name,
    email: ctx.user.email,
    accountType: ctx.user.email.toLowerCase().endsWith("@student.monash.edu")
      ? "student"
      : "staff",
  })),
});
