"""Application configuration. All secrets come from environment variables only."""
import os

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "AI Crypto Investor"
    app_version: str = "0.1.0"
    environment: str = "development"  # development | production

    database_url: str = "sqlite:///./data/app.db"

    # Auth (Phase 1: single admin user seeded from env; real user management later)
    jwt_secret_key: str = "CHANGE-ME-IN-PRODUCTION-use-a-long-random-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60
    admin_username: str = "admin"
    # Set ADMIN_PASSWORD_HASH (bcrypt) in production. If unset, dev default is used.
    admin_password_hash: str = ""

    # Trading modes. Real mode is HARD-DISABLED in Phase 1.
    real_trading_enabled: bool = False
    default_simulation_mode: str = "simulation"  # simulation | paper

    # Exchange API keys (Phase 5+). Read-only keys only: no withdrawal
    # permission + IP whitelist at the exchange. Never stored in the DB.
    kraken_api_key: str = ""
    kraken_api_secret: str = ""
    coinbase_api_key: str = ""
    coinbase_api_secret: str = ""

    # Risk defaults (server-enforced from Phase 3; pure math available now)
    initial_capital_usd: str = "20.00"
    max_risk_per_trade_pct: str = "1.0"
    max_daily_loss_usd: str = "0.40"
    max_trades_per_day: int = 3

    # Email alerts (Phase 7). If unset, alerts are logged, not sent.
    alert_smtp_host: str = ""
    alert_smtp_port: int = 587
    alert_smtp_user: str = ""
    alert_smtp_password: str = ""
    alert_email_from: str = "alerts@localhost"
    alert_email_to: str = ""

    # CORS: comma-separated list of allowed frontend origins.
    # Default covers local dev and the Render production frontend.
    cors_origins: str = "http://localhost:3000,https://crypto-investor-web.onrender.com"

    # AI assistant model (Phase 7+). Default is the local stub (no network,
    # answers labeled DEMO). Set ai_provider=openai-compatible plus the
    # three vars below to use a real OpenAI-compatible endpoint. The key
    # never leaves the backend.
    ai_provider: str = "stub"  # stub | openai-compatible
    ai_api_url: str = ""
    ai_api_key: str = ""
    ai_model: str = ""


settings = Settings()


def assert_production_secrets(s: "Settings | None" = None) -> None:
    """Fail closed en producción: negarse a arrancar sin secretos reales.

    Solo se activa cuando environment == "production" o RENDER == "true"
    (Render inyecta RENDER=true en sus servicios). En local y en tests no
    hace nada. La comparación usa el valor por defecto del propio campo
    (Settings.model_fields), sin escribirlo en ningún informe.
    """
    st = s or settings
    if st.environment != "production" and os.environ.get("RENDER") != "true":
        return
    default_secret = Settings.model_fields["jwt_secret_key"].default
    if (
        st.jwt_secret_key == default_secret
        or len(st.jwt_secret_key) < 32
        or not st.admin_password_hash
    ):
        raise RuntimeError(
            "Refusing to start in production without real secrets: set "
            "JWT_SECRET_KEY (long, random) and ADMIN_PASSWORD_HASH (bcrypt) "
            "in the API service environment."
        )
