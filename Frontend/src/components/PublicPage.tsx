import type { ReactNode } from "react";
import Link from "next/link";
import { PortalNav } from "@/components/PortalNav";
import { Blueprint } from "@/components/ui/Blueprint";
import { Tag } from "@/components/ui/Tag";

export function PublicPage({
  active,
  title,
  intro,
  children,
}: {
  active: "about" | "help" | "contact";
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="public-page">
      <PortalNav active={active} />
      <main className="public-main">
        <Blueprint className="public-panel bg-bg">
          <header className="public-heading">
            <div className="public-title-row">
              <h1>{title}</h1>
              <Tag tone="outline">
                {active === "help"
                  ? "Help"
                  : active === "about"
                    ? "About"
                    : "Contact"}
              </Tag>
            </div>
            <p>{intro}</p>
          </header>
          <div className="public-content">{children}</div>
        </Blueprint>
      </main>
      <footer className="public-footer">
        <span>Enrolment Assistant · Monash University</span>
        <Link href="/login">Open planner</Link>
      </footer>
    </div>
  );
}
