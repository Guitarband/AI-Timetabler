export interface CourseTiming {
  id: string;
  kind: string;
  label: string;
  day: number;
  startMinute: number;
  endMinute: number;
  room: string;
  enabled: boolean;
}

export interface Course {
  code: string;
  title: string;
  faculty: string;
  description: string;
  credits: number;
  timings: CourseTiming[];
  available: boolean;
}

export interface CourseCatalogue {
  termId: string;
  term: string;
  demo: boolean;
  courses: Course[];
  selected: string[];
  completed: boolean;
}

export const courseOnboardingMessage = {
  steps: [],
  text: "Choose your courses first so I can plan around the classes you want to take. Browse by faculty and preview every class time before choosing. Your question will stay in this conversation.",
  action: "course_onboarding" as const,
};

export function sameCourses(left: string[], right: string[]) {
  return (
    new Set(left).size === new Set(right).size &&
    left.every((code) => right.includes(code))
  );
}

export function filterCourses(
  courses: Course[],
  query: string,
  faculty: string,
  availability: string,
  selected: string[],
  sort: string,
) {
  const search = query.trim().toLocaleLowerCase();
  return courses
    .filter(
      (course) =>
        (!search ||
          `${course.code} ${course.title} ${course.description}`
            .toLocaleLowerCase()
            .includes(search)) &&
        (!faculty || course.faculty === faculty) &&
        (availability !== "available" || course.available) &&
        (availability !== "selected" || selected.includes(course.code)),
    )
    .sort(
      (a, b) =>
        a.faculty.localeCompare(b.faculty) ||
        (sort === "title"
          ? a.title.localeCompare(b.title)
          : sort === "credits"
            ? a.credits - b.credits || a.code.localeCompare(b.code)
            : a.code.localeCompare(b.code)),
    );
}

// Connected overlaps share columns, so every published alternative remains visible.
export function layoutTimings(timings: CourseTiming[]) {
  const result: (CourseTiming & { lane: number; lanes: number })[] = [];
  for (const day of [1, 2, 3, 4, 5, 6, 7]) {
    const sorted = timings
      .filter((timing) => timing.day === day)
      .sort(
        (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute,
      );
    let cluster: typeof result = [];
    let ends: number[] = [];
    const flush = () => {
      for (const item of cluster) result.push({ ...item, lanes: ends.length });
      cluster = [];
      ends = [];
    };
    for (const timing of sorted) {
      if (ends.length && timing.startMinute >= Math.max(...ends)) flush();
      let lane = ends.findIndex((end) => end <= timing.startMinute);
      if (lane < 0) lane = ends.length;
      ends[lane] = timing.endMinute;
      cluster.push({ ...timing, lane, lanes: 1 });
    }
    flush();
  }
  return result;
}

export const courseTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
