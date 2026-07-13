-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('QUEUED', 'FAILED_TO_QUEUE');

-- CreateTable
CREATE TABLE "ClaimDocument" (
    "id" TEXT NOT NULL,

    CONSTRAINT "ClaimDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimRun" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL,

    CONSTRAINT "ClaimRun_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ClaimRun" ADD CONSTRAINT "ClaimRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ClaimDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
