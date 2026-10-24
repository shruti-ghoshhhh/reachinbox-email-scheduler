CREATE TABLE "slack_rate_limit_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "hourlyLimit" INTEGER NOT NULL,
    "nextWindowAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_rate_limit_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "slack_rate_limit_notifications_senderId_windowStart_key"
    ON "slack_rate_limit_notifications"("senderId", "windowStart");
CREATE INDEX "slack_rate_limit_notifications_status_leaseExpiresAt_idx"
    ON "slack_rate_limit_notifications"("status", "leaseExpiresAt");

ALTER TABLE "slack_rate_limit_notifications"
    ADD CONSTRAINT "slack_rate_limit_notifications_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "slack_rate_limit_notifications"
    ADD CONSTRAINT "slack_rate_limit_notifications_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "senders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
