-- CreateEnum
CREATE TYPE "GroupTopic" AS ENUM ('ANXIETY', 'DEPRESSION', 'GRIEF', 'STRESS', 'RELATIONSHIPS', 'SUBSTANCE_USE', 'OTHER');

-- CreateEnum
CREATE TYPE "GroupStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REMOVED', 'LEFT');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "safety_alerts" ADD COLUMN     "groupMessageId" TEXT;

-- CreateTable
CREATE TABLE "support_groups" (
    "id" TEXT NOT NULL,
    "facilitatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" "GroupTopic" NOT NULL,
    "description" TEXT NOT NULL,
    "rules" TEXT,
    "maxMembers" INTEGER NOT NULL DEFAULT 12,
    "status" "GroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_memberships" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT,
    "pseudonym" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING',
    "consentAcceptedAt" TIMESTAMP(3) NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_messages" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "membershipId" TEXT,
    "authoredByFacilitator" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_reports" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "reporterMembershipId" TEXT NOT NULL,
    "reason" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "group_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_groups_facilitatorId_idx" ON "support_groups"("facilitatorId");

-- CreateIndex
CREATE INDEX "support_groups_status_topic_idx" ON "support_groups"("status", "topic");

-- CreateIndex
CREATE INDEX "group_memberships_userId_idx" ON "group_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "group_memberships_groupId_userId_key" ON "group_memberships"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "group_memberships_groupId_pseudonym_key" ON "group_memberships"("groupId", "pseudonym");

-- CreateIndex
CREATE INDEX "group_messages_groupId_createdAt_idx" ON "group_messages"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "group_reports_status_idx" ON "group_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "group_reports_messageId_reporterMembershipId_key" ON "group_reports"("messageId", "reporterMembershipId");

-- AddForeignKey
ALTER TABLE "support_groups" ADD CONSTRAINT "support_groups_facilitatorId_fkey" FOREIGN KEY ("facilitatorId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "support_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_messages" ADD CONSTRAINT "group_messages_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "support_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_messages" ADD CONSTRAINT "group_messages_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "group_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_reports" ADD CONSTRAINT "group_reports_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "group_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_reports" ADD CONSTRAINT "group_reports_reporterMembershipId_fkey" FOREIGN KEY ("reporterMembershipId") REFERENCES "group_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
