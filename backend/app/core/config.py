"""Server configuration shared by the API and command-line tools."""

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / '.env')

DATABASE_ENV_KEYS = (
    'SUPABASE_DB_HOST', 'SUPABASE_DB_PORT', 'SUPABASE_DB_NAME',
    'SUPABASE_DB_USER', 'SUPABASE_DB_PASSWORD',
)


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
