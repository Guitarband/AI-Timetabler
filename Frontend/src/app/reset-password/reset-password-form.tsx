"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { useAuth } from "@/trpc/hooks/auth";

export function ResetPasswordForm({ token }: { token: string }) {
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password") || "");
    if (newPassword !== String(form.get("confirmation") || "")) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    try {
      await auth.resetPassword.mutateAsync({ token, newPassword });
      setComplete(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Password reset failed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Choose a new password"
      description="Your new password must have at least 8 characters."
    >
      {!token ? (
        <p className="form-message error" role="alert">
          This reset link is missing its token.
        </p>
      ) : complete ? (
        <div className="auth-confirmation" aria-live="polite">
          <h3>Password updated</h3>
          <p>Sign in with your new password to continue.</p>
          <Link className="primary-button" href="/login">
            Go to sign in
          </Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={reset}>
          <label className="field">
            <span>New password</span>
            <input
              autoComplete="new-password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input
              autoComplete="new-password"
              name="confirmation"
              required
              type="password"
            />
          </label>
          {error && (
            <p className="form-message error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? "Updating password…" : "Update password"}
          </button>
        </form>
      )}
      <p className="auth-bottom-link">
        <Link href="/forgot-password">Request another link</Link>
      </p>
    </AuthShell>
  );
}
