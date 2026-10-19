import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/PublicPage";

export const metadata: Metadata = { title: "About · Enrolment Assistant" };

export default function AboutPage() {
  return (
    <PublicPage
      active="about"
      title="About the enrolment assistant"
      intro="A course-planning prototype for comparing class times and shaping a workable week."
    >
      <section className="public-row">
        <h2>Plan around your week</h2>
        <p>
          Choose courses, set preferences, and review class options in one
          weekly timetable. You can adjust a draft before confirming it in the
          prototype.
        </p>
      </section>
      <section className="public-row">
        <h2>Compare schedules</h2>
        <p>
          When sample or approved student data is available, the planner can
          show where class times overlap with a friend’s timetable.
        </p>
      </section>
      <section className="public-row">
        <h2>Prototype notice</h2>
        <p>
          Course availability and student records may be sample data. This tool
          does not submit official enrolment changes. Check university sources
          before making enrolment decisions.
        </p>
      </section>
      <div className="public-actions">
        <Link className="primary-button" href="/login">
          Open the planner
        </Link>
      </div>
    </PublicPage>
  );
}
