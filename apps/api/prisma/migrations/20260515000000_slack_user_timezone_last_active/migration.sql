-- Add timezone and last_active_at to slack_users
ALTER TABLE "slack_users" ADD COLUMN "timezone" TEXT;
ALTER TABLE "slack_users" ADD COLUMN "last_active_at" TIMESTAMPTZ;

-- Migrate timezone data from user_mappings
UPDATE "slack_users" su
SET "timezone" = um."user_timezone"
FROM "user_mappings" um
WHERE um."slack_id" = su."slack_id"
  AND um."user_timezone" IS NOT NULL;

-- Remove user_timezone from user_mappings
ALTER TABLE "user_mappings" DROP COLUMN IF EXISTS "user_timezone";
