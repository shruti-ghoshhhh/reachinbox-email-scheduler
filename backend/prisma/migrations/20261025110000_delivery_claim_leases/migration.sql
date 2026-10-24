ALTER TYPE "EmailStatus" ADD VALUE IF NOT EXISTS 'DELIVERY_UNKNOWN';

ALTER TABLE "email_jobs"
  ADD COLUMN "claimToken" TEXT,
  ADD COLUMN "claimLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "deliveryAttemptStartedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryMessageId" TEXT;

