-- Existing SENDING rows have no evidence about whether SMTP was called.
-- Preserve the no-automatic-resend guarantee across this schema upgrade.
UPDATE "email_jobs"
SET status = 'DELIVERY_UNKNOWN',
    "errorMessage" = 'SMTP delivery outcome is unknown after scheduler upgrade; automatic resend was stopped to avoid a possible duplicate.'
WHERE status = 'SENDING' AND "claimLeaseExpiresAt" IS NULL;
