"""Select the configured provider. Paid calls need MATH_MATE_AI_PROVIDER=deepseek."""

from ...core.config import ai_settings
from ..types import AINotConfigured
from .deepseek import DeepSeekProvider
from .fake import FakeProvider

_fake = None


def fake_provider():
    # One shared instance so tests can queue scripted responses.
    global _fake
    if _fake is None:
        _fake = FakeProvider()
    return _fake


def reset_fake_provider():
    global _fake
    _fake = None


def get_provider():
    settings = ai_settings()
    if settings.provider == 'fake':
        return fake_provider()
    if settings.provider == 'deepseek' and settings.api_key:
        return DeepSeekProvider(settings)
    raise AINotConfigured()
