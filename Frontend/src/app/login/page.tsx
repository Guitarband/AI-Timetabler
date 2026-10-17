"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { isMonashEmail } from "@/lib/monash-email";
import { useAuth } from "@/trpc/hooks/auth";

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    if (!isMonashEmail(email)) {
      setError("Use a @student.monash.edu or @monash.edu address.");
      return;
    }
    setPending(true);

    try {
      await auth.signIn.mutateAsync({
        email: email.trim(),
        password: String(form.get("password") || ""),
      });
      router.replace("/courses?afterLogin=1");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Sign in failed. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  async function resendVerification() {
    setError("");
    setNotice("");
    if (!isMonashEmail(email)) {
      setError("Enter your Monash email address first.");
      return;
    }
    setPending(true);
    try {
      await auth.resendVerification.mutateAsync({ email: email.trim() });
      setNotice("If this account needs verification, check your Monash inbox.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not send the email.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      description="Use the Monash address you registered with."
    >
      <form className="auth-form" onSubmit={signIn}>
        <label className="field">
          <span>Email address</span>
          <input
            autoComplete="email"
            inputMode="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@student.monash.edu"
            required
            type="email"
            value={email}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            autoComplete="current-password"
            name="password"
            required
            type="password"
          />
        </label>
        <div className="form-utility">
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
        {error && (
          <p className="form-message error" role="alert">
            {error}
          </p>
        )}
        {notice && <output className="form-message success">{notice}</output>}
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="auth-secondary">
        <span>
          New here? <Link href="/signup">Create an account</Link>
        </span>
        <button
          disabled={pending || !email}
          onClick={resendVerification}
          type="button"
        >
          Resend verification email
        </button>
      </div>
    </AuthShell>
  );
}
