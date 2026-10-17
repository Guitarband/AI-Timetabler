import Link from "next/link";
import { redirect } from "next/navigation";
import { PortalNav } from "@/components/PortalNav";
import { SessionGuard } from "@/components/session-guard";
import { Blueprint } from "@/components/ui/Blueprint";
import { getServerCaller } from "@/trpc/server";

export default async function AccountPage() {
  const caller = await getServerCaller();
  const session = await caller.auth.session();
  if (!session.signedIn) redirect("/login");
  return (
    <SessionGuard userId={session.user.id}>
      <div className="account-page">
        <PortalNav studentName={session.user.name} active="account" />
        <main className="auth-main">
          <Blueprint className="auth-shell">
            <section className="auth-panel">
              <h1>Your account</h1>
              <p className="auth-panel-description">
                Your Monash email is verified.
              </p>
              <dl className="account-details">
                <dt>Name</dt>
                <dd>{session.user.name}</dd>
                <dt>Email</dt>
                <dd>{session.user.email}</dd>
              </dl>
              <Link className="primary-button" href="/">
                Open my timetable
              </Link>
            </section>
          </Blueprint>
        </main>
      </div>
    </SessionGuard>
  );
}
