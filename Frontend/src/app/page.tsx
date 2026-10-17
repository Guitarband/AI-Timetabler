import { redirect } from "next/navigation";
import { EnrolmentPage } from "@/components/enrolment-page";
import { getServerCaller } from "@/trpc/server";

export default async function Home() {
  const caller = await getServerCaller();
  const session = await caller.auth.session();
  if (!session.signedIn) redirect("/login");
  return <EnrolmentPage key={session.user.id} user={session.user} />;
}
