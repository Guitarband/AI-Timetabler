import type { ReactNode } from "react";

export type TagTone = "accent" | "neutral" | "outline" | "solid";

export function Tag({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: TagTone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={`tag tag-${tone} ${className}`}>{children}</span>;
}
