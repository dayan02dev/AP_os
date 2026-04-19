"""Application configuration loaded from environment / .env.

Single source of truth for every env var the backend reads. Never read
`os.environ` directly elsewhere — import `settings` (or `get_settings()`)
instead, so missing vars fail loudly and in one place.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── Environment ─────────────────────────────────────────────
    env: str = Field(default="dev", description="dev | staging | prod")

    # ── Supabase ────────────────────────────────────────────────
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str

    # ── OpenRouter (Phase 5) ────────────────────────────────────
    openrouter_api_key: str = ""
    openrouter_model: str = "google/gemini-2.0-flash-001"

    # ── AWS SES (Phase 6) ───────────────────────────────────────
    aws_region: str = "ap-south-1"
    ses_from_email: str = ""
    support_recipient_emails: str = ""  # comma-separated

    # ── CORS ────────────────────────────────────────────────────
    # Comma-separated list of origins allowed to call the API.
    frontend_origin: str = "http://localhost:5173"

    # ── Observability ───────────────────────────────────────────
    sentry_dsn: str = ""
    log_level: str = "INFO"

    # ── Rate limit ──────────────────────────────────────────────
    # Default for every route unless overridden by @limiter.limit(...)
    rate_limit_default: str = "60/minute"

    @property
    def cors_origins(self) -> list[str]:
        """Parse FRONTEND_ORIGIN into a list of origins."""
        return [o.strip() for o in self.frontend_origin.split(",") if o.strip()]

    @property
    def support_recipients_list(self) -> list[str]:
        return [e.strip() for e in self.support_recipient_emails.split(",") if e.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Memoised accessor. Tests can clear the cache via `get_settings.cache_clear()`."""
    return Settings()


# Convenience singleton — most code should use this. Only use `get_settings()`
# in tests or when you need to clear the cache.
settings: Settings = get_settings()
