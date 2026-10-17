"use client";

// Account operations use the same tRPC/React Query provider as the rest of the app.
export { useAuth, useSession } from "@/trpc/hooks/auth";
