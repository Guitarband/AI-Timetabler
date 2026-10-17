"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/trpc/hooks/auth";

export function SignOutButton({
  beforeSignOut,
  disabled = false,
}: {
  beforeSignOut?: () => Promise<boolean>;
  disabled?: boolean;
} = {}) {
  const auth = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSignOut() {
    setPending(true);
    setError("");
    try {
      if (beforeSignOut && !(await beforeSignOut())) {
        setError(
          "Your changes could not be saved. Retry saving before signing out.",
        );
        return;
      }
      await auth.signOut.mutateAsync();
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Sign out failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending || disabled}
        onClick={handleSignOut}
        className="secondary-button"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
