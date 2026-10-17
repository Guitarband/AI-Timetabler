import { isMonashEmail } from "@/lib/monash-email";

// The production bypass is limited to the sample-data MVP demo and requires two
// explicit server configuration flags. Real planner deployments always verify.
export function requiresEmailVerification() {
  const verificationDisabled =
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === "false";
  const localBypass = process.env.NODE_ENV === "development";
  const demoBypass =
    process.env.NODE_ENV === "production" &&
    process.env.AUTH_ALLOW_UNVERIFIED_DEMO === "true" &&
    process.env.NEXT_PUBLIC_USE_MOCK === "true";

  return !(verificationDisabled && (localBypass || demoBypass));
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
