CREATE TABLE "saved_timetable" (
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "planVersion" INTEGER,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "snapshot" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "mutationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saved_timetable_pkey" PRIMARY KEY ("userId", "mode", "id"),
    CONSTRAINT "saved_timetable_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "saved_timetable_mode_check" CHECK ("mode" IN ('mock', 'real')),
    CONSTRAINT "saved_timetable_revision_check" CHECK ("revision" > 0)
);

CREATE INDEX "saved_timetable_userId_mode_updatedAt_idx" ON "saved_timetable"("userId", "mode", "updatedAt");

CREATE TABLE "timetable_library" (
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "activeId" TEXT,
    CONSTRAINT "timetable_library_pkey" PRIMARY KEY ("userId", "mode"),
    CONSTRAINT "timetable_library_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "timetable_library_mode_check" CHECK ("mode" IN ('mock', 'real'))
);
