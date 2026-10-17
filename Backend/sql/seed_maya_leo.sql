-- Fictional prototype records only. No passwords or login accounts are created.
-- Safe to rerun: existing records and edited timetables are preserved.
BEGIN;

DO $$ BEGIN
IF EXISTS (SELECT 1 FROM "user" WHERE ("studentId"='32000001' AND id<>'sample-maya') OR ("studentId"='32000002' AND id<>'sample-leo')
  OR (id='sample-maya' AND "studentId" IS DISTINCT FROM '32000001') OR (id='sample-leo' AND "studentId" IS DISTINCT FROM '32000002')) THEN
  RAISE EXCEPTION 'Sample student IDs already belong to other accounts';
END IF;
END $$;

INSERT INTO "academic_term" ("id","name") VALUES
('2026-fall','Fall 2026')
ON CONFLICT DO NOTHING;

INSERT INTO "course" ("code","title","credits") VALUES
('PSYC 1010','Introduction to Psychology',3),
('STAT 2010','Statistics for Behavioural Science',3),
('BIOL 1020','Cells and Organisms',3),
('WRIT 1000','Academic Writing',3),
('PHIL 1100','Introduction to Philosophy',3)
ON CONFLICT DO NOTHING;

INSERT INTO "course_class" ("id","courseCode","termId","kind") VALUES
('psyc-1010-lecture','PSYC 1010','2026-fall','Lecture'),
('psyc-1010-tutorial','PSYC 1010','2026-fall','Tutorial'),
('stat-2010-lecture','STAT 2010','2026-fall','Lecture'),
('stat-2010-lab','STAT 2010','2026-fall','Lab'),
('biol-1020-lab','BIOL 1020','2026-fall','Lab'),
('biol-1020-lecture','BIOL 1020','2026-fall','Lecture'),
('writ-1000-workshop','WRIT 1000','2026-fall','Workshop'),
('phil-1100-seminar','PHIL 1100','2026-fall','Seminar')
ON CONFLICT DO NOTHING;

INSERT INTO "class_option" ("id","classId","label","day","startMinute","endMinute","room","capacity") VALUES
('psyc-l02','psyc-1010-lecture','L-02',1,600,690,'Hale Hall 204',30),
('psyc-t05','psyc-1010-tutorial','T-05',3,600,660,'Kerr 105',30),
('stat-l01','stat-2010-lecture','L-01',2,660,750,'Maud Building 1',30),
('stat-b04','stat-2010-lab','B-04',2,840,930,'Computing Lab B',30),
('biol-w02','biol-1020-lab','W-02',1,780,870,'Wet Lab 3',30),
('biol-l03','biol-1020-lecture','L-03',4,630,720,'Science Theatre 2',30),
('writ-w01','writ-1000-workshop','W-01',3,900,990,'Studio 2',30),
('writ-w03','writ-1000-workshop','W-03',3,690,780,'Studio 4',30),
('phil-s02','phil-1100-seminar','S-02',4,780,870,'Kerr 210',30),
('phil-s01','phil-1100-seminar','S-01',5,540,630,'Kerr 210',30)
ON CONFLICT DO NOTHING;

-- Deliberately full option, visible to the catalogue but never selectable.

INSERT INTO "class_option" ("id","classId","label","day","startMinute","endMinute","room","capacity") VALUES
('writ-w99-full','writ-1000-workshop','W-99',3,780,870,'Studio 3',0)
ON CONFLICT DO NOTHING;

INSERT INTO "user" (id,name,email,"studentId","emailVerified","updatedAt") VALUES
('sample-maya','Maya Okafor','maya.prototype@example.invalid','32000001',false,now()),
('sample-leo','Leo Chen','leo.prototype@example.invalid','32000002',false,now())
ON CONFLICT DO NOTHING;

INSERT INTO "course_approval" ("userId","termId","courseCode") VALUES
('sample-maya','2026-fall','PSYC 1010'),
('sample-maya','2026-fall','STAT 2010'),
('sample-maya','2026-fall','BIOL 1020'),
('sample-maya','2026-fall','WRIT 1000'),
('sample-maya','2026-fall','PHIL 1100')
ON CONFLICT DO NOTHING;

INSERT INTO "student_timetable" ("id","userId","termId") VALUES
('sample-maya:2026-fall','sample-maya','2026-fall')
ON CONFLICT DO NOTHING;

INSERT INTO "timetable_entry" ("timetableId","termId","classId","optionId") VALUES
('sample-maya:2026-fall','2026-fall','psyc-1010-lecture','psyc-l02'),
('sample-maya:2026-fall','2026-fall','psyc-1010-tutorial','psyc-t05'),
('sample-maya:2026-fall','2026-fall','stat-2010-lecture','stat-l01'),
('sample-maya:2026-fall','2026-fall','stat-2010-lab','stat-b04'),
('sample-maya:2026-fall','2026-fall','biol-1020-lab','biol-w02'),
('sample-maya:2026-fall','2026-fall','biol-1020-lecture','biol-l03'),
('sample-maya:2026-fall','2026-fall','phil-1100-seminar','phil-s01'),
('sample-maya:2026-fall','2026-fall','writ-1000-workshop','writ-w01')
ON CONFLICT DO NOTHING;

INSERT INTO "class_enrolment" ("userId","classId","optionId") VALUES
('sample-maya','biol-1020-lecture','biol-l03'),
('sample-maya','biol-1020-lab','biol-w02'),
('sample-maya','phil-1100-seminar','phil-s01'),
('sample-maya','psyc-1010-lecture','psyc-l02'),
('sample-maya','psyc-1010-tutorial','psyc-t05'),
('sample-maya','stat-2010-lab','stat-b04'),
('sample-maya','stat-2010-lecture','stat-l01'),
('sample-maya','writ-1000-workshop','writ-w01')
ON CONFLICT DO NOTHING;

INSERT INTO "course_approval" ("userId","termId","courseCode") VALUES
('sample-leo','2026-fall','PSYC 1010'),
('sample-leo','2026-fall','STAT 2010'),
('sample-leo','2026-fall','BIOL 1020'),
('sample-leo','2026-fall','WRIT 1000'),
('sample-leo','2026-fall','PHIL 1100')
ON CONFLICT DO NOTHING;

INSERT INTO "student_timetable" ("id","userId","termId") VALUES
('sample-leo:2026-fall','sample-leo','2026-fall')
ON CONFLICT DO NOTHING;

INSERT INTO "timetable_entry" ("timetableId","termId","classId","optionId") VALUES
('sample-leo:2026-fall','2026-fall','psyc-1010-lecture','psyc-l02'),
('sample-leo:2026-fall','2026-fall','psyc-1010-tutorial','psyc-t05'),
('sample-leo:2026-fall','2026-fall','stat-2010-lecture','stat-l01'),
('sample-leo:2026-fall','2026-fall','stat-2010-lab','stat-b04'),
('sample-leo:2026-fall','2026-fall','biol-1020-lab','biol-w02'),
('sample-leo:2026-fall','2026-fall','biol-1020-lecture','biol-l03'),
('sample-leo:2026-fall','2026-fall','phil-1100-seminar','phil-s02'),
('sample-leo:2026-fall','2026-fall','writ-1000-workshop','writ-w03')
ON CONFLICT DO NOTHING;

INSERT INTO "class_enrolment" ("userId","classId","optionId") VALUES
('sample-leo','biol-1020-lecture','biol-l03'),
('sample-leo','biol-1020-lab','biol-w02'),
('sample-leo','phil-1100-seminar','phil-s02'),
('sample-leo','psyc-1010-lecture','psyc-l02'),
('sample-leo','psyc-1010-tutorial','psyc-t05'),
('sample-leo','stat-2010-lab','stat-b04'),
('sample-leo','stat-2010-lecture','stat-l01'),
('sample-leo','writ-1000-workshop','writ-w03')
ON CONFLICT DO NOTHING;

COMMIT;
