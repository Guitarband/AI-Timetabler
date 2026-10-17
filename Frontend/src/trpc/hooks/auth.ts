"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "../client";

export function useSession() {
  const trpc = useTRPC();
  return useQuery(
    trpc.auth.session.queryOptions(undefined, { staleTime: 0, retry: false }),
  );
}

export function useAuth() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  async function clearAccountCache() {
    // Cancel in-flight reads before clearing so a previous user's data cannot return.
    await queryClient.cancelQueries();
    queryClient.clear();
  }
  return {
    signIn: useMutation(
      trpc.auth.signIn.mutationOptions({ onSuccess: clearAccountCache }),
    ),
    signUp: useMutation(trpc.auth.signUp.mutationOptions()),
    signOut: useMutation(
      trpc.auth.signOut.mutationOptions({ onSuccess: clearAccountCache }),
    ),
    resendVerification: useMutation(
      trpc.auth.resendVerification.mutationOptions(),
    ),
    requestPasswordReset: useMutation(
      trpc.auth.requestPasswordReset.mutationOptions(),
    ),
    resetPassword: useMutation(
      trpc.auth.resetPassword.mutationOptions({ onSuccess: clearAccountCache }),
    ),
  };
}
