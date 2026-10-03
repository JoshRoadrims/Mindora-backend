-- CreateEnum
CREATE TYPE "StudentRateMethod" AS ENUM ('STUDENT_EMAIL', 'YOUNG_ADULT_ID');

-- CreateEnum
CREATE TYPE "StudentRateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "isStudentRateBooking" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "professionals" ADD COLUMN     "studentRateFeeKes" INTEGER,
ADD COLUMN     "supervisorName" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "studentRateEligible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "student_rate_verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" "StudentRateMethod" NOT NULL,
    "evidence" TEXT NOT NULL,
    "filePath" TEXT,
    "status" "StudentRateStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_rate_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_rate_verifications_userId_idx" ON "student_rate_verifications"("userId");

-- CreateIndex
CREATE INDEX "student_rate_verifications_status_idx" ON "student_rate_verifications"("status");

-- AddForeignKey
ALTER TABLE "student_rate_verifications" ADD CONSTRAINT "student_rate_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
