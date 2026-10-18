"""Detect the final answer in student-facing text before it is shown.

This is a documented heuristic: both sides are normalised (LaTeX delimiters,
spacing around operators, simple fractions) and the answer is matched as a
standalone token. A false positive only swaps the reply for a safe template.
"""

import re

_QUALIFIERS = re.compile(r'\b(final answer|oe|cao|isw|nfww|www|or better|seen|only|accept|allow|ft)\b', re.I)
_PIECES = re.compile(r'\s+or\s+|;|,(?![^()]*\))|\band\b')


def normalise(text):
    text = (text or '').lower()
    text = re.sub(r'\\(left|right|displaystyle)\b', '', text)
    text = re.sub(r'\\[dt]frac', r'\\frac', text)
    text = re.sub(r'\\frac\{([^{}]+)\}\{([^{}]+)\}', r'\1/\2', text)
    for old, new in (('$', ''), ('\\,', ' '), ('\\ ', ' '), ('\\times', '*'), ('\\cdot', '*'), ('×', '*'), ('−', '-')):
        text = text.replace(old, new)
    text = re.sub(r'\s*([=+\-*/^(),{}<>])\s*', r'\1', text)
    return re.sub(r'\s+', ' ', text).strip()


def contains(normalised_text, token):
    return re.search(rf'(?<![a-z0-9.\\]){re.escape(token)}(?![a-z0-9])', normalised_text) is not None


def answer_tokens(answer, prompt_text=''):
    """Distinctive forms of the final answer, excluding values printed in the question."""
    prompt = normalise(prompt_text)
    tokens = []
    for piece in _PIECES.split(answer or ''):
        piece = normalise(_QUALIFIERS.sub('', piece)).strip(' .')
        if not re.search(r'\d|\^|\\|[a-z]\(', piece):
            continue
        for candidate in [piece] + ([piece.split('=')[-1]] if '=' in piece else []):
            candidate = candidate.strip(' .')
            if len(candidate) >= 2 and candidate not in tokens and not contains(prompt, candidate):
                tokens.append(candidate)
    return tuple(tokens)


def without_student_text(tokens, *student_texts):
    # A student who has already written the answer may hear it confirmed.
    seen = normalise(' '.join(text for text in student_texts if text))
    return tuple(token for token in tokens if not contains(seen, token))


def leaks(text, tokens):
    normalised = normalise(text)
    return any(contains(normalised, token) for token in tokens)
