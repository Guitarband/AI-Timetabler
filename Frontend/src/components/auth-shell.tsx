import type { ReactNode } from "react";
import { PortalNav } from "@/components/PortalNav";
import { Blueprint } from "@/components/ui/Blueprint";

type AuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};
export function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <div className="auth-page">
      <PortalNav active="auth" />
      <main className="auth-main">
        <Blueprint className="auth-shell">
          <section className="auth-panel" aria-labelledby="form-title">
            <h1 id="form-title">{title}</h1>
            <p className="auth-panel-description">{description}</p>
            {children}
          </section>
        </Blueprint>
      </main>
    </div>
  );
}
