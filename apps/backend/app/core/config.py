from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    APP_NAME: str = "PFM Backend"
    ENV: str = "dev"

    # 기본 SQLite 파일 DB (개인 개발/운영에 적합)
    # apps/backend/db.sqlite3를 절대경로로 지정하여 CWD에 따른 경로 문제 방지
    _default_db_path = Path(__file__).resolve().parents[2] / "db.sqlite3"
    DATABASE_URL: str = f"sqlite:///{_default_db_path}"

    CORS_ORIGINS: list[str] = ["*"]
    TIMEZONE: str = "Asia/Seoul"

    model_config = SettingsConfigDict(env_file=(".env",), env_prefix="PFM_", case_sensitive=False)


settings = Settings()
