"""Application configuration loaded from environment / .env.

Single source of truth for every env var the backend reads. Never read
`os.environ` directly elsewhere — import `settings` (or `get_settings()`)
instead, so missing vars fail loudly and in one place.

Phase 8 additions:
  - APP_ENV typed as Literal["development","staging","production"]
  - APP_VERSION auto-read from pyproject.toml (falls back to "0.0.0-dev")
  - FRONTEND_ORIGINS (plural) list — FRONTEND_ORIGIN kept as back-compat alias
  - ADMIN_API_KEY required (≥32 chars). In non-production, a dev-only default
    is accepted but logged as a warning at startup.
  - LOG_LEVEL typed Literal
"""

from __future__ import annotations

import logging
import tomllib
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# ─── App version (read once at import) ─────────────────────────

def _read_app_version() -> str:
    try:
        root = Path(__file__).resolve().parent.parent
        with (root / "pyproject.toml").open("rb") as f:
            data = tomllib.load(f)
        project = data.get("project") or {}
        return project.get("version") or "0.0.0-dev"
    except Exception:
        return "0.0.0-dev"


APP_VERSION = _read_app_version()

DEV_ADMIN_KEY_SENTINEL = "dev-only-do-not-use-in-prod-____________"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── Environment ─────────────────────────────────────────────
    # We prefer APP_ENV as the env-var name because plain ENV is generic
    # enough to clash with other tooling. Pydantic's default would map the
    # field name `env` to env var `ENV`; override that.
    env: Literal["development", "staging", "production", "dev", "prod"] = Field(
        default="development",
        validation_alias=AliasChoices("APP_ENV", "ENV"),
    )

    # ── Supabase ────────────────────────────────────────────────
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str

    # ── OpenRouter ──────────────────────────────────────────────
    openrouter_api_key: str = ""
    # gemini-2.5-flash is paid (separate quota from the rate-limited free
    # gemini-2.0 tier) and benchmarks at 5s for our resume/template
    # prompts vs 20s+ when 2.0 throttles and falls through to gpt-4o-mini.
    openrouter_model: str = "google/gemini-2.5-flash"

    # ── Email (Resend HTTP API) ─────────────────────────────────
    # We migrated off AWS SES because sandbox-mode recipient verification
    # blocks real applicants (Phase 9D). Resend accepts any recipient as
    # long as the sender domain is verified, and artpark.info is already
    # DKIM-verified in Resend for Supabase OTPs.
    #
    # The field name stays as `ses_from_email` for back-compat with callers;
    # only the transport changed. Set via `SES_FROM_EMAIL` or the alias
    # `EMAIL_FROM` in the environment.
    resend_api_key: str = ""
    ses_from_email: str = Field(
        default="",
        validation_alias=AliasChoices("SES_FROM_EMAIL", "EMAIL_FROM"),
    )
    support_recipient_emails: str = ""

    # ── AWS region (retained for future boto3 use; not read by email) ──
    # AWS_REGION is a *reserved* Lambda env var that the runtime pre-populates
    # with the region the function is running in — you can't override it in a
    # CloudFormation/SAM template. So in production we set AWS_REGION_APP via
    # the SAM template and read that first. Local .env still uses AWS_REGION
    # (via the alias) so dev boxes don't need a new name.
    aws_region: str = Field(
        default="ap-south-1",
        validation_alias=AliasChoices("AWS_REGION_APP", "AWS_REGION"),
    )

    # ── CORS ────────────────────────────────────────────────────
    # FRONTEND_ORIGIN (singular) is the back-compat env var — it's parsed into
    # FRONTEND_ORIGINS (plural) which is a list. Comma-separated values are
    # supported in either field; prod typically sets multiple origins
    # (localhost dev, staging, production) so middleware can allow all three.
    frontend_origin: str = "http://localhost:5173"

    # ── Observability ───────────────────────────────────────────
    sentry_dsn: str = ""
    log_level: Literal["DEBUG", "INFO", "WARN", "WARNING", "ERROR"] = "INFO"

    # ── Rate limit ──────────────────────────────────────────────
    rate_limit_default: str = "60/minute"

    # ── Admin API (Phase 8) ─────────────────────────────────────
    # Guards /admin/* endpoints. Required at runtime; a dev-only sentinel is
    # tolerated in non-production, logged at WARN and rejected outright when
    # env is production (see __post_init_validation).
    admin_api_key: str = Field(default=DEV_ADMIN_KEY_SENTINEL, min_length=32)

    # Edit-after-submit window deadlines (ISO 8601, IST). After these, a
    # submitted application locks. Configurable so dates change without a deploy.
    edit_deadline_tir: str = "2026-06-25T23:59:59+05:30"
    edit_deadline_sip: str = "2026-07-05T23:59:59+05:30"

    # ── TIR intake close (reversible toggle) ────────────────────
    # When true, the TIR track is CLOSED to new intake:
    #   • new TIR account creation via the signup path (request-otp track=tir),
    #   • new TIR draft creation, and
    #   • TIR submission
    # are all blocked. Existing TIR applicants keep sign-in / view / edit-window
    # access (this flag never touches existing rows or existing auth users), and
    # the SIP/VIP track is entirely unaffected (separate code paths). Flip via
    # the TIR_SUBMISSIONS_CLOSED env var — no code change to reopen.
    tir_submissions_closed: bool = False

    # ── SIP/VIP intake close (reversible toggle) ────────────────
    # Same semantics as tir_submissions_closed, for the SIP/VIP track: when
    # true, new SIP account creation (request-otp track=sip), new SIP draft
    # creation, and SIP submission are all blocked. Existing SIP applicants
    # keep sign-in / view / edit-window access; the TIR track is unaffected.
    # Flip via the SIP_SUBMISSIONS_CLOSED env var — no code change to reopen.
    sip_submissions_closed: bool = False

    # ─── Normalisers ────────────────────────────────────────────
    @field_validator("env")
    @classmethod
    def _normalise_env(cls, v: str) -> str:
        # Accept short aliases "dev" / "prod" that other parts of the stack use.
        v = v.lower()
        return {
            "dev": "development",
            "prod": "production",
        }.get(v, v)

    @field_validator("log_level")
    @classmethod
    def _normalise_log_level(cls, v: str) -> str:
        # "WARN" is a common alias for "WARNING" in other stacks.
        return "WARNING" if v.upper() == "WARN" else v.upper()

    # ─── Derived helpers ────────────────────────────────────────
    @property
    def app_version(self) -> str:
        return APP_VERSION

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def frontend_origins(self) -> list[str]:
        """Parse FRONTEND_ORIGIN (comma-separated) into a list. Trimmed."""
        return [o.strip() for o in self.frontend_origin.split(",") if o.strip()]

    # Legacy alias — some old code references `cors_origins`.
    @property
    def cors_origins(self) -> list[str]:
        return self.frontend_origins

    @property
    def support_recipients_list(self) -> list[str]:
        return [e.strip() for e in self.support_recipient_emails.split(",") if e.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Memoised accessor. Tests can clear the cache via `get_settings.cache_clear()`."""
    s = Settings()
    _startup_validation(s)
    return s


def _startup_validation(s: Settings) -> None:
    """Shout early for config states that should never reach production."""
    log = logging.getLogger("app.config")
    if s.admin_api_key == DEV_ADMIN_KEY_SENTINEL:
        if s.is_production:
            raise RuntimeError(
                "ADMIN_API_KEY is using the dev-only sentinel value but "
                "APP_ENV=production. Generate a real key "
                "(`python -c 'import secrets; print(secrets.token_urlsafe(48))'`) "
                "and set it in the environment."
            )
        log.warning(
            "ADMIN_API_KEY is using the dev-only sentinel. OK for development, "
            "but rotate before deploying."
        )


# Convenience singleton — most code should use this. Only use `get_settings()`
# in tests or when you need to clear the cache.
settings: Settings = get_settings()
