"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
  const [confirming, setConfirming] = useState(false);

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
        onClick={() => {
          setError("");
          setConfirming(true);
        }}
        className="secondary-button"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {confirming && (
        <ConfirmDialog
          title="Sign out?"
          description="Are you sure you want to sign out? Any pending timetable changes will be saved first."
          confirmLabel="Sign out"
          busy={pending}
          error={error}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void handleSignOut()}
        />
      )}
      {error && !confirming && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
