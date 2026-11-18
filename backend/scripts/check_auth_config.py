"""Check public Supabase Auth settings needed by Math Mate."""

import httpx

from ..app.core.config import auth_settings


if __name__ == '__main__':
    settings = auth_settings()
    if not settings['url'] or not settings['publishable_key']:
        raise SystemExit('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required.')
    try:
        response = httpx.get(
            f"{settings['url']}/auth/v1/settings",
            headers={'apikey': settings['publishable_key']},
            timeout=httpx.Timeout(8),
        )
        response.raise_for_status()
    except httpx.HTTPError:
        raise SystemExit('Supabase Auth settings could not be reached.') from None
    config = response.json()
    print(f"Email provider enabled: {bool((config.get('external') or {}).get('email'))}")
    print(f"New sign-ups enabled: {not bool(config.get('disable_signup'))}")
    print(f"Email confirmation required: {not bool(config.get('mailer_autoconfirm'))}")
