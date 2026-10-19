"""MATH_MATE_DB switches every connection between Supabase and a local database."""

import pytest

from backend.app.db.connection import connection_settings
from backend.scripts.targets import selected_targets

SETTINGS = {
    'SUPABASE_DB_HOST': 'pooler.example.test', 'SUPABASE_DB_PORT': '5432', 'SUPABASE_DB_NAME': 'postgres',
    'SUPABASE_DB_USER': 'remote', 'SUPABASE_DB_PASSWORD': 'remote-secret',
    'LOCAL_DB_HOST': '127.0.0.1', 'LOCAL_DB_PORT': '5433', 'LOCAL_DB_NAME': 'math-mate',
    'LOCAL_DB_USER': 'local', 'LOCAL_DB_PASSWORD': 'local-secret',
}


@pytest.fixture
def env(monkeypatch):
    for key in (*SETTINGS, 'MATH_MATE_DB', 'SUPABASE_DB_SSLMODE', 'LOCAL_DB_SSLMODE'):
        monkeypatch.delenv(key, raising=False)
    for key, value in SETTINGS.items():
        monkeypatch.setenv(key, value)
    return monkeypatch


def test_supabase_is_the_default_and_requires_tls(env):
    settings = connection_settings()
    assert (settings['host'], settings['user'], settings['sslmode']) == ('pooler.example.test', 'remote', 'require')


def test_one_variable_switches_to_the_local_database(env):
    env.setenv('MATH_MATE_DB', 'local')
    env.setenv('LOCAL_DB_SSLMODE', 'disable')
    settings = connection_settings()
    assert (settings['host'], settings['port'], settings['dbname'], settings['sslmode']) == ('127.0.0.1', '5433', 'math-mate', 'disable')
    assert connection_settings('supabase')['host'] == 'pooler.example.test'


def test_unknown_or_incomplete_targets_are_explained(env):
    env.setenv('MATH_MATE_DB', 'staging')
    with pytest.raises(RuntimeError, match='MATH_MATE_DB must be one of'):
        connection_settings()
    env.setenv('MATH_MATE_DB', 'local')
    env.delenv('LOCAL_DB_PASSWORD')
    with pytest.raises(RuntimeError, match='LOCAL_DB_PASSWORD'):
        connection_settings()


def test_all_targets_means_every_configured_database(env):
    assert selected_targets('all') == ['supabase', 'local']
    env.delenv('LOCAL_DB_HOST')
    assert selected_targets('all') == ['supabase']
    env.setenv('MATH_MATE_DB', 'local')
    assert selected_targets('current') == ['local']
