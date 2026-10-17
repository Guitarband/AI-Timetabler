-- CreateTable
-- Additive migration: existing accounts and security tables are preserved.
CREATE TABLE "academic_term" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "academic_term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course" (
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,

    CONSTRAINT "course_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "course_class" (
    "id" TEXT NOT NULL,
    "courseCode" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "course_class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_option" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "room" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "class_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_approval" (
    "userId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "courseCode" TEXT NOT NULL,

    CONSTRAINT "course_approval_pkey" PRIMARY KEY ("userId","termId","courseCode")
);

-- CreateTable
CREATE TABLE "student_timetable" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "planId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_timetable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_entry" (
    "timetableId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,

    CONSTRAINT "timetable_entry_pkey" PRIMARY KEY ("timetableId","classId")
);

-- CreateTable
CREATE TABLE "class_enrolment" (
    "userId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,

    CONSTRAINT "class_enrolment_pkey" PRIMARY KEY ("userId","classId")
);

-- CreateTable
CREATE TABLE "plan_family" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "head" TEXT NOT NULL,
    "confirmation" JSONB,

    CONSTRAINT "plan_family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planner_plan" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planner_plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_class_termId_courseCode_idx" ON "course_class"("termId", "courseCode");

-- CreateIndex
CREATE UNIQUE INDEX "course_class_id_termId_key" ON "course_class"("id", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "class_option_id_classId_key" ON "class_option"("id", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "class_option_classId_label_key" ON "class_option"("classId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "student_timetable_userId_termId_key" ON "student_timetable"("userId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "student_timetable_id_termId_key" ON "student_timetable"("id", "termId");

-- CreateIndex
CREATE INDEX "class_enrolment_optionId_idx" ON "class_enrolment"("optionId");

-- CreateIndex
CREATE INDEX "plan_family_ownerId_termId_idx" ON "plan_family"("ownerId", "termId");

-- CreateIndex
CREATE INDEX "planner_plan_familyId_idx" ON "planner_plan"("familyId");

-- AddForeignKey
ALTER TABLE "course_class" ADD CONSTRAINT "course_class_courseCode_fkey" FOREIGN KEY ("courseCode") REFERENCES "course"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_class" ADD CONSTRAINT "course_class_termId_fkey" FOREIGN KEY ("termId") REFERENCES "academic_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_option" ADD CONSTRAINT "class_option_classId_fkey" FOREIGN KEY ("classId") REFERENCES "course_class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_approval" ADD CONSTRAINT "course_approval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_approval" ADD CONSTRAINT "course_approval_termId_fkey" FOREIGN KEY ("termId") REFERENCES "academic_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_approval" ADD CONSTRAINT "course_approval_courseCode_fkey" FOREIGN KEY ("courseCode") REFERENCES "course"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_timetable" ADD CONSTRAINT "student_timetable_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_timetable" ADD CONSTRAINT "student_timetable_termId_fkey" FOREIGN KEY ("termId") REFERENCES "academic_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entry" ADD CONSTRAINT "timetable_entry_timetableId_termId_fkey" FOREIGN KEY ("timetableId", "termId") REFERENCES "student_timetable"("id", "termId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entry" ADD CONSTRAINT "timetable_entry_classId_termId_fkey" FOREIGN KEY ("classId", "termId") REFERENCES "course_class"("id", "termId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entry" ADD CONSTRAINT "timetable_entry_optionId_classId_fkey" FOREIGN KEY ("optionId", "classId") REFERENCES "class_option"("id", "classId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrolment" ADD CONSTRAINT "class_enrolment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrolment" ADD CONSTRAINT "class_enrolment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "course_class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrolment" ADD CONSTRAINT "class_enrolment_optionId_classId_fkey" FOREIGN KEY ("optionId", "classId") REFERENCES "class_option"("id", "classId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_family" ADD CONSTRAINT "plan_family_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_family" ADD CONSTRAINT "plan_family_termId_fkey" FOREIGN KEY ("termId") REFERENCES "academic_term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planner_plan" ADD CONSTRAINT "planner_plan_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "plan_family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE course ADD CONSTRAINT course_credits_nonnegative CHECK (credits >= 0);
ALTER TABLE class_option ADD CONSTRAINT class_option_valid_time CHECK
    (day BETWEEN 1 AND 5 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute");
ALTER TABLE class_option ADD CONSTRAINT class_option_capacity_nonnegative CHECK (capacity >= 0);
CREATE INDEX user_name_lookup ON "user" (lower(name) text_pattern_ops) WHERE "studentId" IS NOT NULL;

-- Protect capacity even when administrators use Prisma or SQL directly.
CREATE FUNCTION enforce_class_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected class_option%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM id FROM class_option WHERE id=OLD."optionId" FOR UPDATE;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        PERFORM id FROM class_option WHERE id IN (OLD."optionId",NEW."optionId") ORDER BY id FOR UPDATE;
    END IF;
    SELECT * INTO selected FROM class_option WHERE id=NEW."optionId" FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF; -- Foreign key reports the missing option.
    IF NOT selected.enabled OR
       (SELECT count(*) FROM class_enrolment WHERE "optionId"=NEW."optionId"
        AND NOT ("userId"=NEW."userId" AND "classId"=NEW."classId")) >= selected.capacity THEN
        RAISE EXCEPTION 'Class option is full or closed' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER class_enrolment_capacity BEFORE INSERT OR UPDATE OR DELETE ON class_enrolment
    FOR EACH ROW EXECUTE FUNCTION enforce_class_capacity();

CREATE FUNCTION prevent_capacity_underflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.capacity < (SELECT count(*) FROM class_enrolment WHERE "optionId"=NEW.id) THEN
        RAISE EXCEPTION 'Capacity cannot be smaller than current enrolment' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER class_option_capacity_update BEFORE UPDATE OF capacity ON class_option
    FOR EACH ROW EXECUTE FUNCTION prevent_capacity_underflow();
