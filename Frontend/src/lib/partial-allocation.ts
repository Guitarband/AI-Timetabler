import {
  type Course,
  type CourseCatalogue,
  type CourseTiming,
  courseTime,
} from "./courses";
import type { Section } from "./types";

export interface MissingClass {
  classId: string;
  code: string;
  kind: string;
}

export interface PartialAllocation {
  sections: Section[];
  missing: MissingClass[];
  totalClasses: number;
  limited: boolean;
}

type Group = MissingClass & {
  course: Course;
  options: CourseTiming[];
  lecture: boolean;
};

const SEARCH_LIMIT = 100_000;
const isLecture = (kind: string) => /\blecture\b/i.test(kind);

function overlaps(left: CourseTiming, right: CourseTiming) {
  return (
    left.day === right.day &&
    left.startMinute < right.endMinute &&
    right.startMinute < left.endMinute
  );
}

/** A preview only: the server validates matching and owns drafts and bookings. */
export function bestPartialAllocation(
  catalogue: CourseCatalogue,
): PartialAllocation | null {
  const groupsById = new Map<string, Group>();
  for (const course of catalogue.courses.filter((item) =>
    catalogue.selected.includes(item.code),
  )) {
    for (const timing of course.timings) {
      if (!Number.isInteger(timing.day) || timing.day < 1 || timing.day > 5)
        continue;
      const classId = timing.classId ?? `${course.code}:${timing.kind}`;
      let group = groupsById.get(classId);
      if (!group) {
        group = {
          classId,
          code: course.code,
          kind: timing.kind,
          course,
          options: [],
          lecture: isLecture(timing.kind),
        };
        groupsById.set(classId, group);
      }
      if (timing.enabled && timing.selectable !== false)
        group.options.push(timing);
    }
  }
  const groups = [...groupsById.values()].sort(
    (a, b) =>
      Number(a.lecture) - Number(b.lecture) ||
      a.options.length - b.options.length ||
      a.code.localeCompare(b.code) ||
      a.kind.localeCompare(b.kind) ||
      a.classId.localeCompare(b.classId),
  );
  if (!groups.length) return null;
  for (const group of groups)
    group.options.sort(
      (a, b) =>
        a.day - b.day ||
        a.startMinute - b.startMinute ||
        a.id.localeCompare(b.id),
    );

  const remainingNonLectures = Array<number>(groups.length + 1).fill(0);
  for (let i = groups.length - 1; i >= 0; i--)
    remainingNonLectures[i] =
      remainingNonLectures[i + 1] + Number(!groups[i].lecture);

  let visited = 0;
  let limited = false;
  let best: (CourseTiming | null)[] = [];
  let bestNonLectures = -1;
  let bestCount = -1;
  const selected: (CourseTiming | null)[] = [];
  const visit = (index: number, nonLectures: number, count: number) => {
    if (++visited > SEARCH_LIMIT) {
      limited = true;
      return;
    }
    if (
      nonLectures + remainingNonLectures[index] < bestNonLectures ||
      (nonLectures + remainingNonLectures[index] === bestNonLectures &&
        count + groups.length - index <= bestCount)
    )
      return;
    if (index === groups.length) {
      if (
        nonLectures > bestNonLectures ||
        (nonLectures === bestNonLectures && count > bestCount)
      ) {
        best = [...selected];
        bestNonLectures = nonLectures;
        bestCount = count;
      }
      return;
    }
    const group = groups[index];
    for (const option of group.options) {
      if (selected.some((other) => other && overlaps(option, other))) continue;
      selected.push(option);
      visit(index + 1, nonLectures + Number(!group.lecture), count + 1);
      selected.pop();
      if (limited) return;
    }
    selected.push(null);
    visit(index + 1, nonLectures, count);
    selected.pop();
  };
  visit(0, 0, 0);

  const sections = best.flatMap((option, index): Section[] =>
    option
      ? [
          {
            key: option.id,
            code: groups[index].code,
            title: groups[index].course.title,
            kind: groups[index].kind,
            section: option.label,
            day: option.day as Section["day"],
            start: courseTime(option.startMinute),
            end: courseTime(option.endMinute),
            room: option.room,
            credits: groups[index].course.credits,
            with_friend: false,
            changed: false,
          },
        ]
      : [],
  );
  const missing = groups.flatMap((group, index) =>
    best[index]
      ? []
      : [{ classId: group.classId, code: group.code, kind: group.kind }],
  );
  return { sections, missing, totalClasses: groups.length, limited };
}
