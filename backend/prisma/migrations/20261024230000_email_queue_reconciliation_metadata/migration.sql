-- Persist campaign delivery settings so recovered queue jobs retain their
-- original rate limit and inter-message delay.
ALTER TABLE "email_jobs"
ADD COLUMN "hourlyLimit" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN "delayBetweenEmailsMs" INTEGER NOT NULL DEFAULT 2000;
