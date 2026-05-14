-- CreateTable
CREATE TABLE "slack_users" (
    "slack_id" TEXT NOT NULL,
    "real_name" TEXT,
    "display_name" TEXT,
    "email" TEXT,
    "avatar_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "current_presence" TEXT,
    "current_status_text" TEXT,
    "current_status_emoji" TEXT,
    "last_presence_update" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slack_users_pkey" PRIMARY KEY ("slack_id")
);

-- CreateTable
CREATE TABLE "presence_history" (
    "id" BIGSERIAL NOT NULL,
    "slack_id" TEXT NOT NULL,
    "presence" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presence_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_history" (
    "id" BIGSERIAL NOT NULL,
    "slack_id" TEXT NOT NULL,
    "status_text" TEXT,
    "status_emoji" TEXT,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mappings" (
    "id" TEXT NOT NULL,
    "slack_id" TEXT NOT NULL,
    "user_timezone" TEXT,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable: settings
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ix_presence_history_slack_id_recorded_at" ON "presence_history"("slack_id", "recorded_at");

-- CreateIndex
CREATE INDEX "ix_status_history_slack_id_recorded_at" ON "status_history"("slack_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_mappings_slack_id_key" ON "user_mappings"("slack_id");

-- AddForeignKey
ALTER TABLE "presence_history" ADD CONSTRAINT "presence_history_slack_id_fkey" FOREIGN KEY ("slack_id") REFERENCES "slack_users"("slack_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_slack_id_fkey" FOREIGN KEY ("slack_id") REFERENCES "slack_users"("slack_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mappings" ADD CONSTRAINT "user_mappings_slack_id_fkey" FOREIGN KEY ("slack_id") REFERENCES "slack_users"("slack_id") ON DELETE RESTRICT ON UPDATE CASCADE;
