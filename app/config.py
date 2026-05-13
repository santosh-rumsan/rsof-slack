from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Slack
    slack_bot_token: str

    # PostgreSQL
    database_url: str  # postgresql+asyncpg://...

    # Auth
    api_key: str
    jwt_public_key_pem: str = ""  # RS256 public key PEM string

    # User management system
    user_mgmt_api_url: str = ""
    user_mgmt_api_key: str = ""

    # Scheduler intervals (minutes)
    user_sync_interval: int = 30
    presence_reconcile_interval: int = 5
    user_mapping_sync_interval: int = 60

    # App
    app_port: int = 8000
    log_level: str = "info"
    frontend_dist: str = "frontend/dist"


settings = Settings()
