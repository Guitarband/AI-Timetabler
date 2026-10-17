-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "timetable_preference" (
    "userId" TEXT NOT NULL,
    "earliestStartMinute" INTEGER NOT NULL DEFAULT 540,
    "latestEndMinute" INTEGER NOT NULL DEFAULT 1080,
    "preferredDays" "Weekday"[] NOT NULL DEFAULT ARRAY[]::"Weekday"[],
    "avoidedDays" "Weekday"[] NOT NULL DEFAULT ARRAY[]::"Weekday"[],
    "maxCampusDays" INTEGER,
    "prioritizeFriends" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timetable_preference_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "timetable_preference_valid_minutes" CHECK (
        "earliestStartMinute" >= 0 AND "earliestStartMinute" < "latestEndMinute" AND "latestEndMinute" <= 1440
    ),
    CONSTRAINT "timetable_preference_valid_days" CHECK (
        "maxCampusDays" IS NULL OR "maxCampusDays" BETWEEN 1 AND 7
    ),
    CONSTRAINT "timetable_preference_no_day_overlap" CHECK (
        NOT ("preferredDays" && "avoidedDays")
    )
);

-- CreateTable
CREATE TABLE "friendship" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "friendship_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "friendship_canonical_pair" CHECK (
        "userAId" COLLATE "C" < "userBId" COLLATE "C" AND
        "requestedById" IN ("userAId", "userBId")
    )
);

-- CreateIndex
CREATE INDEX "friendship_userAId_status_idx" ON "friendship"("userAId", "status");

-- CreateIndex
CREATE INDEX "friendship_userBId_status_idx" ON "friendship"("userBId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "friendship_userAId_userBId_key" ON "friendship"("userAId", "userBId");

-- AddForeignKey
ALTER TABLE "timetable_preference" ADD CONSTRAINT "timetable_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
