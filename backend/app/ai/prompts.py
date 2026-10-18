"""Load versioned system prompts. The version is a hash of the file contents."""

import hashlib
from dataclasses import dataclass
from functools import cache
from pathlib import Path

PROMPTS = Path(__file__).parent / 'prompts'


@dataclass(frozen=True)
class Prompt:
    text: str
    version: str


@cache
def prompt(name):
    text = (PROMPTS / f'{name}.md').read_text(encoding='utf-8')
    return Prompt(text, f'{name}-{hashlib.sha256(text.encode()).hexdigest()[:12]}')
