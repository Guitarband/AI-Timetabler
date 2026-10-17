ALTER TABLE "course" ADD COLUMN "faculty" TEXT NOT NULL DEFAULT 'Other faculties';
ALTER TABLE "course" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';

-- Metadata for the bundled fictional catalogue; other courses retain explicit empty defaults.
UPDATE "course" SET "faculty" = 'Science', "description" = 'Study cells and living organisms through lectures and laboratory work.' WHERE "code" = 'BIOL 1020';
UPDATE "course" SET "faculty" = 'Science', "description" = 'Develop statistical reasoning for behavioural research, with lectures and practical data analysis labs.' WHERE "code" = 'STAT 2010';
UPDATE "course" SET "faculty" = 'Arts', "description" = 'Practise academic argument, evidence and clear writing in workshops.' WHERE "code" = 'WRIT 1000';
UPDATE "course" SET "faculty" = 'Arts', "description" = 'Examine foundational philosophical questions and practise critical reasoning in seminars.' WHERE "code" = 'PHIL 1100';
UPDATE "course" SET "faculty" = 'Medicine, Nursing and Health Sciences', "description" = 'Explore human behaviour, cognition and the foundations of psychological research through lectures and tutorials.' WHERE "code" = 'PSYC 1010';

CREATE TABLE "course_onboarding" (
  "userId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "termId" TEXT NOT NULL,
  "courseCodes" TEXT[] NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "course_onboarding_pkey" PRIMARY KEY ("userId", "mode", "termId"),
  CONSTRAINT "course_onboarding_user_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);
