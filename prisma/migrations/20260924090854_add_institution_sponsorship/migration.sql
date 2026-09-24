/*
  Warnings:

  - A unique constraint covering the columns `[enrollmentCode]` on the table `institutions` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `enrollmentCode` to the `institutions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "institutionCoveredKes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sponsoringInstitutionId" TEXT;

-- AlterTable
ALTER TABLE "institutions" ADD COLUMN     "coveragePercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "enrollmentCode" TEXT;

-- Backfill enrollmentCode for any existing rows before making it required
UPDATE "institutions" SET "enrollmentCode" = substr(md5(random()::text || id), 1, 8) WHERE "enrollmentCode" IS NULL;

ALTER TABLE "institutions" ALTER COLUMN "enrollmentCode" SET NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "institutionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "institutions_enrollmentCode_key" ON "institutions"("enrollmentCode");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_sponsoringInstitutionId_fkey" FOREIGN KEY ("sponsoringInstitutionId") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;