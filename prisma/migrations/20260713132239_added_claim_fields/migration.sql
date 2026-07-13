/*
  Warnings:

  - Added the required column `claimType` to the `ClaimDocument` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fileHash` to the `ClaimDocument` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('motor', 'health');

-- AlterTable
ALTER TABLE "ClaimDocument" ADD COLUMN     "claimType" "ClaimType" NOT NULL,
ADD COLUMN     "fileHash" TEXT NOT NULL;
