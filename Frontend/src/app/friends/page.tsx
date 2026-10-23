import { redirect } from "next/navigation";
import { FriendsPanel } from "@/components/FriendsPanel";
import { PortalNav } from "@/components/PortalNav";
import { SessionGuard } from "@/components/session-guard";
import { getServerCaller } from "@/trpc/server";

export default async function FriendsPage() {
  const caller = await getServerCaller();
  const session = await caller.auth.session();
  if (!session.signedIn) redirect("/login");
  return (
    <SessionGuard userId={session.user.id}>
      <div className="account-page">
        <PortalNav studentName={session.user.name} active="friends" />
        <main className="auth-main">
          <section className="auth-panel w-full max-w-2xl">
            <h1>Friends</h1>
            <FriendsPanel key={session.user.id} />
          </section>
        </main>
      </div>
    </SessionGuard>
  );
}
