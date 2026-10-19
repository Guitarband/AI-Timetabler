import { isMonashEmail } from "@/lib/monash-email";

// Email verification never blocks registration, sign-in, or general app access.
// Monash address domains and student ID format are still validated separately.
export function requiresEmailVerification() {
  return false;
}

export function isEligibleUser<
  T extends { email: string; emailVerified: boolean },
>(user: T | null | undefined): user is T {
  return (
    !!user &&
    isMonashEmail(user.email) &&
    (!requiresEmailVerification() || user.emailVerified)
  );
}
