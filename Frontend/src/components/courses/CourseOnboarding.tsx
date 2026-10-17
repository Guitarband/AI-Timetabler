"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PortalNav } from "@/components/PortalNav";
import { SessionGuard } from "@/components/session-guard";
import {
  type Course,
  type CourseCatalogue,
  filterCourses,
} from "@/lib/courses";
import { coursesApi } from "@/lib/courses-api";
import { CoursePreview } from "./CoursePreview";

export function CourseOnboarding({
  user,
}: {
  user: { id: string; name: string };
}) {
  const router = useRouter();
  const [catalogue, setCatalogue] = useState<CourseCatalogue | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [faculty, setFaculty] = useState("");
  const [availability, setAvailability] = useState("all");
  const [sort, setSort] = useState("code");
  const [preview, setPreview] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await coursesApi.catalogue(user.id);
      setCatalogue(result);
      setSelected(result.selected);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load courses. Retry to continue.",
      );
    } finally {
      setLoading(false);
    }
  }, [user.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const courses = catalogue?.courses ?? [];
  const visible = filterCourses(
    courses,
    query,
    faculty,
    availability,
    selected,
    sort,
  );
  const faculties = [
    ...new Set(courses.map((course) => course.faculty)),
  ].sort();
  const visibleFaculties = [
    ...new Set(visible.map((course) => course.faculty)),
  ];
  const selectedCourses = courses.filter((course) =>
    selected.includes(course.code),
  );
  const invalidSelection = selected.some(
    (code) =>
      !courses.some((course) => course.code === code && course.available),
  );
  const toggle = (code: string) =>
    setSelected((previous) =>
      previous.includes(code)
        ? previous.filter((value) => value !== code)
        : [...previous, code],
    );
  async function save() {
    if (!catalogue || !selected.length || saving || invalidSelection) return;
    setSaving(true);
    setError("");
    try {
      await coursesApi.save(user.id, catalogue.termId, selected);
      router.push("/");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save courses. Your choices are still here; try again.",
      );
      setSaving(false);
    }
  }
  return (
    <SessionGuard userId={user.id}>
      <div className="course-shell">
        <PortalNav
          studentName={user.name}
          term={catalogue?.term}
          active="courses"
          busy={saving}
          beforeLeave={() => Promise.resolve(!saving)}
        />
        <main className="course-main" aria-busy={loading}>
          <div className="course-page-heading">
            <div>
              <h1>Choose your courses</h1>
              <p>
                Select your courses for {catalogue?.term ?? "this term"}. Open a
                course to compare its class times.
              </p>
            </div>
            <Link href="/">Back to timetable</Link>
          </div>
          {catalogue?.demo && (
            <p className="course-demo-note">
              Demo catalogue: these are fictional sample courses and class
              times.
            </p>
          )}
          <div className="course-filters">
            <label className="course-search">
              Search courses
              <input
                type="search"
                value={query}
                placeholder="Course code or name"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              Faculty
              <select
                value={faculty}
                onChange={(event) => setFaculty(event.target.value)}
              >
                <option value="">All faculties</option>
                {faculties.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              Show
              <select
                value={availability}
                onChange={(event) => setAvailability(event.target.value)}
              >
                <option value="all">All courses</option>
                <option value="available">Open for selection</option>
                <option value="selected">Selected courses</option>
              </select>
            </label>
            <label>
              Sort within faculty
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="code">Course code</option>
                <option value="title">Course name</option>
                <option value="credits">Credit points: low to high</option>
              </select>
            </label>
          </div>
          {error && (
            <div className="course-error" role="alert">
              <p>{error}</p>
              {!catalogue && (
                <button
                  type="button"
                  onClick={() => void load()}
                  disabled={loading}
                >
                  Retry loading courses
                </button>
              )}
            </div>
          )}
          {loading ? (
            <output className="course-empty block">Loading courses…</output>
          ) : (
            catalogue && (
              <>
                <output className="course-result-count block">
                  {visible.length} {visible.length === 1 ? "course" : "courses"}{" "}
                  shown
                </output>
                {visibleFaculties.map((name) => (
                  <section
                    key={name}
                    className="course-faculty"
                    aria-label={name}
                  >
                    <h2>
                      {name}
                      <span>
                        {
                          visible.filter((course) => course.faculty === name)
                            .length
                        }{" "}
                        {visible.filter((course) => course.faculty === name)
                          .length === 1
                          ? "course"
                          : "courses"}
                      </span>
                    </h2>
                    <div className="course-rows">
                      {visible
                        .filter((course) => course.faculty === name)
                        .map((course) => (
                          <div
                            key={course.code}
                            className={`course-row ${selected.includes(course.code) ? "course-row-selected" : ""}`}
                          >
                            <button
                              type="button"
                              className="course-open"
                              onClick={() => setPreview(course)}
                              aria-label={`Preview ${course.code}: ${course.title}`}
                            >
                              <span className="course-code">{course.code}</span>
                              <span className="course-name">
                                {course.title}
                              </span>
                              <span className="course-row-meta">
                                {course.credits} credit points ·{" "}
                                {course.timings.length} class times
                                {!course.available && " · Not available"}
                              </span>
                              <span className="course-preview-label">
                                Preview timetable
                              </span>
                            </button>
                            <label className="course-select">
                              <input
                                type="checkbox"
                                checked={selected.includes(course.code)}
                                disabled={
                                  saving ||
                                  (!course.available &&
                                    !selected.includes(course.code)) ||
                                  (!selected.includes(course.code) &&
                                    selected.length >= 20)
                                }
                                onChange={() => toggle(course.code)}
                              />
                              <span className="sr-only">
                                Select {course.code}
                              </span>
                              <span aria-hidden="true">
                                {selected.includes(course.code)
                                  ? "Selected"
                                  : "Select"}
                              </span>
                            </label>
                          </div>
                        ))}
                    </div>
                  </section>
                ))}
                {!visible.length && (
                  <div className="course-empty">
                    <h2>
                      {courses.length
                        ? "No courses match these filters"
                        : "No courses are published for this term"}
                    </h2>
                    {courses.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setQuery("");
                          setFaculty("");
                          setAvailability("all");
                        }}
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                )}
              </>
            )
          )}
        </main>
        <footer className="course-selection-footer">
          <div>
            <strong aria-live="polite">
              {selected.length} {selected.length === 1 ? "course" : "courses"}{" "}
              selected ·{" "}
              {selectedCourses.reduce((sum, course) => sum + course.credits, 0)}{" "}
              credit points
            </strong>
            <div className="course-selected-list">
              {selected.map((code) => (
                <button
                  key={code}
                  disabled={saving}
                  type="button"
                  onClick={() => toggle(code)}
                  aria-label={`Remove ${code}`}
                >
                  {code} ×
                </button>
              ))}
            </div>
            {invalidSelection && (
              <p role="alert">Remove unavailable courses before continuing.</p>
            )}
            <p>
              {selected.length
                ? "Saving prepares a fresh timetable if your courses change. Saved timetables stay in your library."
                : "Select at least one course to continue."}
            </p>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={
              loading ||
              saving ||
              !selected.length ||
              invalidSelection ||
              !catalogue
            }
            onClick={() => void save()}
          >
            {saving ? "Saving courses…" : "Save and continue"}
          </button>
        </footer>
        {preview && (
          <CoursePreview
            course={preview}
            selected={selected.includes(preview.code)}
            canAdd={selected.length < 20}
            onToggle={() => {
              if (selected.includes(preview.code) || selected.length < 20)
                toggle(preview.code);
            }}
            onClose={() => setPreview(null)}
          />
        )}
      </div>
    </SessionGuard>
  );
}
