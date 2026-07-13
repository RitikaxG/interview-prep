/*
  Warnings:

  - Added the required column `uploadedById` to the `ClaimDocument` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdById` to the `ClaimRun` table without a default value. This is not possible if the table is not empty.
  - Added the required column `traceId` to the `ClaimRun` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('reviewer', 'admin');

-- AlterTable
ALTER TABLE "ClaimDocument" ADD COLUMN     "uploadedById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ClaimRun" ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "traceId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ClaimDocument" ADD CONSTRAINT "ClaimDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimRun" ADD CONSTRAINT "ClaimRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
