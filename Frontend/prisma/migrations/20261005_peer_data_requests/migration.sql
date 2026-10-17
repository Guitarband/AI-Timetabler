-- CreateEnum
CREATE TYPE "PeerDataRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PARTIAL', 'DENIED');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "studentId" TEXT;

ALTER TABLE "user" ADD CONSTRAINT "user_studentId_format" CHECK (
    "studentId" IS NULL OR "studentId" ~ '^[0-9]{6,12}$'
);

-- CreateTable
CREATE TABLE "peer_data_request" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "status" "PeerDataRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "peer_data_request_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "peer_data_request_distinct_users" CHECK ("requesterId" <> "recipientId"),
    CONSTRAINT "peer_data_request_response_time" CHECK (
        ("status" = 'PENDING') = ("respondedAt" IS NULL)
    )
);

-- CreateIndex
CREATE INDEX "peer_data_request_recipientId_status_idx" ON "peer_data_request"("recipientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "peer_data_request_requesterId_recipientId_key" ON "peer_data_request"("requesterId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "user_studentId_key" ON "user"("studentId");

-- AddForeignKey
ALTER TABLE "peer_data_request" ADD CONSTRAINT "peer_data_request_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_data_request" ADD CONSTRAINT "peer_data_request_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

