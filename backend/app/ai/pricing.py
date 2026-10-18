"""Verified model prices and worst-case cost estimates for the budget guard."""

from dataclasses import dataclass
from decimal import Decimal

MILLION = Decimal(1_000_000)
# Rough upper bound for one compressed solution page until a live test measures it.
IMAGE_TOKEN_ESTIMATE = 2000


@dataclass(frozen=True)
class Price:
    cache_miss: Decimal
    cache_hit: Decimal
    output: Decimal


# USD per 1M tokens at peak rates, checked 17 October 2026 on
# https://api-docs.deepseek.com/quick_start/pricing. Off-peak is cheaper, so
# peak rates keep every estimate on the safe side.
PRICES = {
    'deepseek-flash': Price(Decimal('0.30'), Decimal('0.006'), Decimal('1.20')),
    'fake': Price(Decimal(0), Decimal(0), Decimal(0)),
}


def price(model):
    if model not in PRICES:
        raise ValueError(f'No verified price for model {model!r}; add one before using it.')
    return PRICES[model]


def cost(model, usage):
    rates = price(model)
    total = (usage.cache_miss * rates.cache_miss + usage.cache_hit * rates.cache_hit
             + usage.completion * rates.output) / MILLION
    return total.quantize(Decimal('0.000001'))


def worst_case(model, input_tokens, max_tokens):
    # Reasoning tokens are billed as output. Until a live test confirms that
    # max_tokens also caps reasoning, callers pass the reasoning allowance too.
    rates = price(model)
    total = (input_tokens * rates.cache_miss + max_tokens * rates.output) / MILLION
    return total.quantize(Decimal('0.000001'))


def estimate_input_tokens(messages):
    characters, images = 0, 0
    for message in messages:
        content = message['content']
        for part in content if isinstance(content, list) else [{'type': 'text', 'text': content}]:
            if part['type'] == 'image_url':
                images += 1
            else:
                characters += len(part['text'])
    # About three characters per token for mixed English and LaTeX, rounded up.
    return characters // 3 + 1 + images * IMAGE_TOKEN_ESTIMATE
