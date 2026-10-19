"""Server configuration shared by the API and command-line tools."""

import os
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / '.env')

# MATH_MATE_DB selects the database: `supabase` (the default, and what Render
# uses) or `local`, a development PostgreSQL. Each reads its own prefixed keys.
DATABASE_TARGETS = {'supabase': 'SUPABASE_DB', 'local': 'LOCAL_DB'}
DATABASE_FIELDS = ('HOST', 'PORT', 'NAME', 'USER', 'PASSWORD')


def database_target():
    target = os.getenv('MATH_MATE_DB', '').strip().lower() or 'supabase'
    if target not in DATABASE_TARGETS:
        raise RuntimeError(f"MATH_MATE_DB must be one of: {', '.join(DATABASE_TARGETS)}")
    return target


def database_env_keys(target):
    return tuple(f'{DATABASE_TARGETS[target]}_{field}' for field in DATABASE_FIELDS)


def database_configured(target):
    return all(os.getenv(key) for key in database_env_keys(target))


def cors_origins():
    value = os.getenv('MATH_MATE_CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173')
    return [origin.strip() for origin in value.split(',') if origin.strip()]


def storage_settings():
    return {
        'url': os.getenv('SUPABASE_URL', '').rstrip('/'),
        'key': os.getenv('SUPABASE_SECRET_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY', ''),
        'bucket': os.getenv('MATH_MATE_STORAGE_BUCKET', 'math-mate-solutions'),
    }


def storage_configured():
    settings = storage_settings()
    return bool(settings['url'] and settings['key'])


@dataclass(frozen=True)
class AISettings:
    provider: str
    api_key: str
    model: str
    base_url: str
    daily_budget_usd: Decimal
    learner_daily_budget_usd: Decimal
    marker_reasoning_effort: str
    marker_max_tokens: int
    observer_max_tokens: int
    tutor_max_tokens: int
    timeout_seconds: float


def ai_settings():
    # Paid calls need an explicit provider choice; a configured key alone is never enough.
    provider = os.getenv('MATH_MATE_AI_PROVIDER', 'off').strip().lower()
    return AISettings(
        provider=provider if provider in ('off', 'fake', 'deepseek') else 'off',
        api_key=os.getenv('DEEPSEEK_API_KEY', '').strip(),
        model=os.getenv('DEEPSEEK_MODEL', 'deepseek-flash').strip() or 'deepseek-flash',
        base_url=os.getenv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').rstrip('/'),
        daily_budget_usd=Decimal(os.getenv('MATH_MATE_AI_DAILY_BUDGET_USD', '0.50')),
        learner_daily_budget_usd=Decimal(os.getenv('MATH_MATE_AI_LEARNER_DAILY_BUDGET_USD', '0.05')),
        marker_reasoning_effort=os.getenv('MATH_MATE_MARKER_REASONING_EFFORT', 'low'),
        marker_max_tokens=int(os.getenv('MATH_MATE_MARKER_MAX_TOKENS', '4096')),
        observer_max_tokens=int(os.getenv('MATH_MATE_OBSERVER_MAX_TOKENS', '200')),
        tutor_max_tokens=int(os.getenv('MATH_MATE_TUTOR_MAX_TOKENS', '400')),
        timeout_seconds=float(os.getenv('MATH_MATE_AI_TIMEOUT_SECONDS', '60')),
    )


def ai_enabled():
    settings = ai_settings()
    return settings.provider == 'fake' or (settings.provider == 'deepseek' and bool(settings.api_key))
