import type { Metadata } from "next";
import { HelpQuestions } from "@/components/HelpQuestions";
import { PublicPage } from "@/components/PublicPage";

export const metadata: Metadata = { title: "Help · Enrolment Assistant" };

export default function HelpPage() {
  return (
    <PublicPage
      active="help"
      title="Help and common questions"
      intro="Find quick answers about the planner, sample data, and printing."
    >
      <HelpQuestions />
    </PublicPage>
  );
}
