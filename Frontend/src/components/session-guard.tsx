"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useSession } from "@/trpc/hooks/auth";

/** Revalidate on focus/reconnect so an expired or changed account hides old data. */
export function SessionGuard({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const session = useSession();
  const router = useRouter();
  const signedOut = session.data?.signedIn === false;
  const changedUser = session.data?.signedIn && session.data.user.id !== userId;

  useEffect(() => {
    if (signedOut) {
      router.replace("/login");
      router.refresh();
    } else if (changedUser) {
      router.refresh();
    }
  }, [signedOut, changedUser, router]);

  if (signedOut || changedUser) return <output>Checking your session…</output>;
  if (session.isError) {
    return (
      <div className="session-error" role="alert">
        <p>
          We couldn't verify your session. Check your connection and try again.
        </p>
        <button
          className="secondary-button"
          type="button"
          onClick={() => session.refetch()}
          disabled={session.isFetching}
        >
          Try again
        </button>
      </div>
    );
  }
  return children;
}
