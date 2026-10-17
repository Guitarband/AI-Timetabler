import { redirect } from "next/navigation";
import { CourseOnboarding } from "@/components/courses/CourseOnboarding";
import { getServerCaller } from "@/trpc/server";

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ afterLogin?: string }>;
}) {
  const caller = await getServerCaller();
  const session = await caller.auth.session();
  if (!session.signedIn) redirect("/login");
  const params = await searchParams;
  if (params.afterLogin === "1") {
    const catalogue = await caller.courses
      .catalogue({ accountId: session.user.id })
      .catch(() => null);
    if (catalogue?.completed) redirect("/");
  }
  return <CourseOnboarding key={session.user.id} user={session.user} />;
}
