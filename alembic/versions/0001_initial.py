"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-13
"""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "slack_users",
        sa.Column("slack_id", sa.String(), nullable=False),
        sa.Column("real_name", sa.Text(), nullable=True),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("current_presence", sa.String(10), nullable=True),
        sa.Column("current_status_text", sa.Text(), nullable=True),
        sa.Column("current_status_emoji", sa.String(100), nullable=True),
        sa.Column("is_busy", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_dnd", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("last_presence_update", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("slack_id"),
    )

    op.create_table(
        "presence_history",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("slack_id", sa.String(), nullable=False),
        sa.Column("presence", sa.String(10), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["slack_id"], ["slack_users.slack_id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_presence_history_slack_id_recorded_at",
        "presence_history",
        ["slack_id", "recorded_at"],
    )

    op.create_table(
        "status_history",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("slack_id", sa.String(), nullable=False),
        sa.Column("status_text", sa.Text(), nullable=True),
        sa.Column("status_emoji", sa.String(100), nullable=True),
        sa.Column("is_busy", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_dnd", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["slack_id"], ["slack_users.slack_id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_status_history_slack_id_recorded_at",
        "status_history",
        ["slack_id", "recorded_at"],
    )

    op.create_table(
        "user_mappings",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("slack_id", sa.String(), nullable=False),
        sa.Column(
            "synced_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["slack_id"], ["slack_users.slack_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slack_id"),
    )


def downgrade() -> None:
    op.drop_table("user_mappings")
    op.drop_index("ix_status_history_slack_id_recorded_at", "status_history")
    op.drop_table("status_history")
    op.drop_index("ix_presence_history_slack_id_recorded_at", "presence_history")
    op.drop_table("presence_history")
    op.drop_table("slack_users")
