import { redirect } from "next/navigation";
import { FriendsPanel } from "@/components/friends/FriendsPanel";
import { getServerCaller } from "@/trpc/server";

export default async function FriendsPage() {
  const caller = await getServerCaller();
  const session = await caller.auth.session();
  if (!session.signedIn) redirect("/login");
  return <FriendsPanel key={session.user.id} user={session.user} />;
}
