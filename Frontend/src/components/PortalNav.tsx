"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { SignOutButton } from "@/app/account/sign-out-button";
import { COPY } from "@/lib/copy";

export function PortalNav({
  term,
  studentName,
  active = "timetable",
  beforeLeave,
  busy = false,
}: {
  term?: string;
  studentName?: string;
  active?:
    | "timetable"
    | "account"
    | "friends"
    | "auth"
    | "courses"
    | "about"
    | "help"
    | "contact";
  beforeLeave?: () => Promise<boolean>;
  busy?: boolean;
}) {
  const router = useRouter();
  const navigate =
    (url: string) => async (event: MouseEvent<HTMLAnchorElement>) => {
      if (!beforeLeave) return;
      event.preventDefault();
      if (!busy && (await beforeLeave())) router.push(url);
    };
  const initials = (studentName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase())
    .slice(0, 2)
    .join("");
  const brandHref =
    studentName === undefined && active !== "auth" ? "/about" : "/";
  return (
    <header className="portal-header">
      <Link
        href={brandHref}
        className="portal-brand"
        onClick={navigate(brandHref)}
      >
        <span className="font-display text-[17px] font-semibold">
          {COPY.portal.university}
        </span>
        <span className="eyebrow ink-50 text-[10px]">{COPY.portal.portal}</span>
      </Link>
      <nav className="portal-links" aria-label="Portal">
        {studentName === undefined && (
          <>
            <Link
              href="/about"
              aria-current={active === "about" ? "page" : undefined}
            >
              About
            </Link>
            <Link
              href="/help"
              aria-current={active === "help" ? "page" : undefined}
            >
              Help
            </Link>
            <Link
              href="/contact"
              aria-current={active === "contact" ? "page" : undefined}
            >
              Contact
            </Link>
          </>
        )}
        {studentName !== undefined ? (
          <>
            <Link
              href="/"
              onClick={navigate("/")}
              aria-current={active === "timetable" ? "page" : undefined}
            >
              Enrolment
            </Link>
            <Link
              href="/courses"
              onClick={navigate("/courses")}
              aria-current={active === "courses" ? "page" : undefined}
            >
              Courses
            </Link>
            <Link
              href="/friends"
              onClick={navigate("/friends")}
              aria-current={active === "friends" ? "page" : undefined}
            >
              Friends
            </Link>
            <Link
              href="/account"
              onClick={navigate("/account")}
              aria-current={active === "account" ? "page" : undefined}
            >
              Account
            </Link>
            {term && <span className="portal-term">{term}</span>}
            <span className="portal-user">{studentName}</span>
            {initials && (
              <span className="portal-avatar" aria-hidden="true">
                {initials}
              </span>
            )}
            <SignOutButton beforeSignOut={beforeLeave} disabled={busy} />
          </>
        ) : active === "auth" ? (
          <span className="portal-term">Student sign in</span>
        ) : (
          <Link href="/login">Sign in</Link>
        )}
      </nav>
    </header>
  );
}
