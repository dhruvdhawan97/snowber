-- CreateEnum
CREATE TYPE "DiscountProgram" AS ENUM ('SENIOR', 'ACCESSIBILITY');

-- CreateEnum
CREATE TYPE "DiscountStatus" AS ENUM ('PENDING', 'APPROVED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "discountProgram" "DiscountProgram",
ADD COLUMN     "discountStatus" "DiscountStatus";

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "discountBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0;
