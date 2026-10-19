import type { Metadata } from "next";
import { PublicPage } from "@/components/PublicPage";

export const metadata: Metadata = { title: "Contact · Enrolment Assistant" };

export default function ContactPage() {
  return (
    <PublicPage
      active="contact"
      title="Contact the project team"
      intro="Share feedback or report a problem with this prototype."
    >
      <section className="public-row">
        <h2>Send feedback</h2>
        <div>
          <p>
            Include the page you were using and what you expected to happen.
            Leave out passwords, student IDs, and other private information.
          </p>
          <a
            className="primary-button public-mail-link"
            href="mailto:enrolment-assistant@example.com?subject=Enrolment%20Assistant%20feedback"
          >
            Email the project team
          </a>
          <p className="public-note">
            The address is a placeholder. Replace it with the team’s contact
            before sharing this page.
          </p>
        </div>
      </section>
      <section className="public-row">
        <h2>Report a display issue</h2>
        <p>
          Describe what you saw, what you expected, and your device and browser.
          This helps the team reproduce layout or accessibility issues.
        </p>
      </section>
    </PublicPage>
  );
}
