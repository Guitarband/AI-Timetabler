"use client";

import { useEffect, useRef } from "react";
import { type Course, courseTime, layoutTimings } from "@/lib/courses";

const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function CoursePreview({
  course,
  selected,
  canAdd = true,
  onToggle,
  onClose,
}: {
  course: Course;
  selected: boolean;
  canAdd?: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  const timings = layoutTimings(course.timings);
  const first =
    Math.floor(
      Math.min(8 * 60, ...timings.map((timing) => timing.startMinute)) / 60,
    ) * 60;
  const last =
    Math.ceil(
      Math.max(18 * 60, ...timings.map((timing) => timing.endMinute)) / 60,
    ) * 60;
  const visibleDays = days.slice(
    0,
    Math.max(5, ...timings.map((timing) => timing.day)),
  );
  const hours = Array.from(
    { length: (last - first) / 60 + 1 },
    (_, index) => first + index * 60,
  );
  const kinds = [...new Set(timings.map((timing) => timing.kind))];
  return (
    <dialog
      ref={dialog}
      className="course-dialog"
      aria-labelledby="course-preview-title"
      onCancel={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="course-dialog-header">
        <h2 id="course-preview-title">
          {course.code} — {course.title}
        </h2>
        <button
          type="button"
          className="course-text-button"
          onClick={onClose}
          aria-label="Close course preview"
        >
          Close ×
        </button>
      </div>
      <div className="course-dialog-body">
        <aside className="course-details" aria-label="Course information">
          <h3>{course.title}</h3>
          <dl>
            <div>
              <dt>Course code</dt>
              <dd>{course.code}</dd>
            </div>
            <div>
              <dt>Faculty</dt>
              <dd>{course.faculty}</dd>
            </div>
            <div>
              <dt>Credit points</dt>
              <dd>{course.credits}</dd>
            </div>
            <div>
              <dt>Class types</dt>
              <dd>{kinds.join(", ") || "Not published"}</dd>
            </div>
            <div>
              <dt>Published class times</dt>
              <dd>{timings.length}</dd>
            </div>
          </dl>
          <h4>About this course</h4>
          <p>
            {course.description ||
              "A description has not been published for this course."}
          </p>
          <button
            type="button"
            className={selected ? "course-secondary-button" : "primary-button"}
            onClick={onToggle}
            disabled={!selected && (!course.available || !canAdd)}
          >
            {selected ? "Remove course" : "Add course"}
          </button>
          {!selected && !canAdd && (
            <p>
              You can select up to 20 courses. Remove one before adding another.
            </p>
          )}
          {!course.available && (
            <p>
              Some required classes have no open options. This course cannot be
              selected yet.
            </p>
          )}
        </aside>
        <section
          className="course-preview"
          aria-label="All published class times"
        >
          <h3>Timetable preview</h3>
          <p>
            All published options are shown. Your timetable will use one option
            for each required class.
          </p>
          <div className="course-preview-legend">
            {kinds.map((kind, index) => (
              <span
                key={kind}
                className={`course-kind course-kind-${index % 4}`}
              >
                {kind}
              </span>
            ))}
          </div>
          {timings.length === 0 ? (
            <p className="course-empty">No class times have been published.</p>
          ) : (
            <>
              <section
                className="course-week-scroll"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the timetable.
                tabIndex={0}
                aria-label="Weekly class timetable; scroll to see all times"
              >
                <div
                  className="course-week"
                  style={{
                    gridTemplateColumns: `52px ${visibleDays.map((_, index) => `minmax(${Math.max(1, ...timings.filter((timing) => timing.day === index + 1).map((timing) => timing.lanes)) * 105}px, 1fr)`).join(" ")}`,
                  }}
                >
                  <div className="course-week-heading">Time</div>
                  {visibleDays.map((day) => (
                    <div className="course-week-heading" key={day}>
                      {day}
                    </div>
                  ))}
                  <div
                    className="course-time-axis"
                    style={{ height: (last - first) * 1.5 + 24 }}
                  >
                    {hours.map((hour) => (
                      <span key={hour} style={{ top: (hour - first) * 1.5 }}>
                        {courseTime(hour)}
                      </span>
                    ))}
                  </div>
                  {visibleDays.map((day, index) => (
                    <div
                      key={day}
                      className="course-day"
                      style={{ height: (last - first) * 1.5 + 24 }}
                    >
                      {timings
                        .filter((timing) => timing.day === index + 1)
                        .map((timing) => (
                          <div
                            key={timing.id}
                            className={`course-time-block course-kind-${kinds.indexOf(timing.kind) % 4} ${timing.enabled ? "" : "course-time-closed"}`}
                            style={{
                              top: (timing.startMinute - first) * 1.5,
                              height: Math.max(
                                24,
                                (timing.endMinute - timing.startMinute) * 1.5 -
                                  3,
                              ),
                              left: `calc(${(timing.lane / timing.lanes) * 100}% + 2px)`,
                              width: `calc(${100 / timing.lanes}% - 4px)`,
                            }}
                            title={`${timing.kind} ${timing.label}, ${day} ${courseTime(timing.startMinute)}–${courseTime(timing.endMinute)}, ${timing.room}${timing.enabled ? "" : " (closed)"}`}
                          >
                            <strong>
                              {timing.kind} {timing.label}
                            </strong>
                            <span>
                              {courseTime(timing.startMinute)}–
                              {courseTime(timing.endMinute)}
                            </span>
                            <span>{timing.room}</span>
                            {!timing.enabled && <span>Closed</span>}
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              </section>
              <details className="course-times-list">
                <summary>
                  View all {timings.length} class times as a list
                </summary>
                <ul>
                  {timings.map((timing) => (
                    <li key={timing.id}>
                      <strong>
                        {timing.kind} {timing.label}
                      </strong>{" "}
                      — {days[timing.day - 1]}, {courseTime(timing.startMinute)}
                      –{courseTime(timing.endMinute)}, {timing.room}
                      {!timing.enabled && " (closed)"}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </section>
      </div>
    </dialog>
  );
}
