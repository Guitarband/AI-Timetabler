"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { isMonashEmail } from "@/lib/monash-email";
import { useAuth } from "@/trpc/hooks/auth";

export default function ForgotPasswordPage() {
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    if (!isMonashEmail(email)) {
      setError("Use a @student.monash.edu or @monash.edu address.");
      return;
    }
    setPending(true);
    try {
      await auth.requestPasswordReset.mutateAsync({
        email,
      });
      setSubmitted(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not request a reset.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Enter your Monash email and we will send a reset link if an account exists."
    >
      {submitted ? (
        <output className="form-message success">
          Check your Monash inbox for a reset link.
        </output>
      ) : (
        <form className="auth-form" onSubmit={requestReset}>
          <label className="field">
            <span>Monash email</span>
            <input autoComplete="email" name="email" required type="email" />
          </label>
          {error && (
            <p className="form-message error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? "Sending link…" : "Send reset link"}
          </button>
        </form>
      )}
      <p className="auth-bottom-link">
        <Link href="/login">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
