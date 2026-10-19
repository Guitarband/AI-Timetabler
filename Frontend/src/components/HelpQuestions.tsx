"use client";
import { useMemo, useState } from "react";

const questions: ReadonlyArray<readonly [string, string]> = [
  [
    "Is this the official enrolment system?",
    "No. This project is a planning prototype and does not submit enrolment changes to the university.",
  ],
  [
    "Why might course information look different?",
    "The catalogue may contain sample or demonstration data. Check official university sources before making enrolment decisions.",
  ],
  [
    "Can I print my timetable?",
    "Open a timetable in the planner and choose Print timetable. In the print dialog, select Save as PDF to keep a digital copy.",
  ],
  [
    "Who can see sample student information?",
    "The prototype includes fictional sample profiles for demonstration. Do not enter private information into shared or demonstration accounts.",
  ],
  [
    "Where can I send feedback?",
    "Use the Contact page to email the project team with the page and a short description of the issue.",
  ],
];

export function HelpQuestions() {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return questions.filter(([question, answer]) =>
      `${question} ${answer}`.toLowerCase().includes(term),
    );
  }, [query]);
  return (
    <>
      <label className="help-search">
        <span>Search answers</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try “print” or “sample data”"
        />
      </label>
      <div className="help-questions">
        <p className="help-result-count" aria-live="polite">
          {query.trim()
            ? `${visible.length} matching ${visible.length === 1 ? "answer" : "answers"}`
            : `${visible.length} common questions`}
        </p>
        {visible.length ? (
          visible.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))
        ) : (
          <p className="help-empty">
            No answers match “{query}”. Try a shorter search.
          </p>
        )}
      </div>
    </>
  );
}
