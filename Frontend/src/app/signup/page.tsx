"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { isMonashEmail } from "@/lib/monash-email";
import { isStudentId } from "@/lib/student-id";
import { useAuth } from "@/trpc/hooks/auth";

export default function SignupPage() {
  const auth = useAuth();
  const [accountType, setAccountType] = useState<"student" | "staff">(
    "student",
  );
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(true);
  const [error, setError] = useState("");

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "")
      .trim()
      .toLowerCase();
    const password = String(form.get("password") || "");
    const confirmation = String(form.get("confirmPassword") || "");
    const studentId = String(form.get("studentId") || "").trim();

    if (!isMonashEmail(email)) {
      setError("Use a @student.monash.edu or @monash.edu address.");
      return;
    }
    if (
      (accountType === "student" && !email.endsWith("@student.monash.edu")) ||
      (accountType === "staff" && !email.endsWith("@monash.edu"))
    ) {
      setError("The email domain does not match the account type selected.");
      return;
    }
    if (accountType === "student" && !isStudentId(studentId)) {
      setError("Enter a student ID with 6 to 12 digits.");
      return;
    }
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    try {
      const result = await auth.signUp.mutateAsync({
        name: String(form.get("name") || ""),
        email,
        password,
        ...(accountType === "student" ? { studentId } : {}),
      });
      setVerificationRequired(result.verificationRequired);
      setSubmitted(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Account creation failed. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      description="Use your Monash university email to create an account."
    >
      {submitted ? (
        <div className="auth-confirmation" aria-live="polite">
          <h3>
            {verificationRequired ? "Check your inbox" : "Account created"}
          </h3>
          <p>
            {verificationRequired
              ? "If this address is eligible, a verification link will arrive in your Monash inbox. Open it before signing in."
              : "You can sign in now with your email and password."}
          </p>
          <Link className="primary-button" href="/login">
            Go to sign in
          </Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={signUp}>
          <label className="field">
            <span>I am a</span>
            <select
              onChange={(event) =>
                setAccountType(event.target.value as "student" | "staff")
              }
              value={accountType}
            >
              <option value="student">Student</option>
              <option value="staff">Staff member</option>
            </select>
          </label>
          <label className="field">
            <span>Full name</span>
            <input
              autoComplete="name"
              maxLength={100}
              name="name"
              required
              type="text"
            />
          </label>
          <label className="field">
            <span>Monash email</span>
            <input
              autoComplete="email"
              inputMode="email"
              name="email"
              placeholder={
                accountType === "student"
                  ? "you@student.monash.edu"
                  : "you@monash.edu"
              }
              required
              type="email"
            />
          </label>
          {accountType === "student" && (
            <label className="field">
              <span>Student ID</span>
              <input
                autoComplete="off"
                inputMode="numeric"
                maxLength={12}
                minLength={6}
                name="studentId"
                pattern="[0-9]{6,12}"
                required
                type="text"
              />
              <small>
                Used for peer lookup. The app does not verify IDs against Monash
                records.
              </small>
            </label>
          )}
          <label className="field">
            <span>Password</span>
            <input
              autoComplete="new-password"
              minLength={8}
              name="password"
              required
              type="password"
            />
            <small>At least 8 characters.</small>
          </label>
          <label className="field">
            <span>Confirm password</span>
            <input
              autoComplete="new-password"
              name="confirmPassword"
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
            {pending ? "Creating account…" : "Create account"}
          </button>
        </form>
      )}
      <p className="auth-bottom-link">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}
