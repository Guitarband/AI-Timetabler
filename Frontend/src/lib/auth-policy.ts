import { isMonashEmail } from "@/lib/monash-email";

// Explicitly opt in for local development; production always verifies ownership.
export function requiresEmailVerification() {
  return !(
    process.env.NODE_ENV === "development" &&
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === "false"
  );
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
