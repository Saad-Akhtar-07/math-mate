"""Curriculum catalogues shipped with the backend: outcomes, skill aliases, misconceptions.

They live under backend/ because the deployed service only contains this folder.
"""

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

CATALOGUE = Path(__file__).parent


@dataclass(frozen=True)
class Outcome:
    code: str
    subtopic: str
    text: str


@dataclass(frozen=True)
class Misconception:
    id: str
    outcomes: tuple
    description: str


def _load(name):
    return json.loads((CATALOGUE / name).read_text(encoding='utf-8'))


@cache
def outcomes():
    return {item['code']: Outcome(item['code'], item['subtopic'], item['text'])
            for item in _load('outcomes.json')['outcomes']}


@cache
def skill_outcomes():
    return {skill: item['code'] for item in _load('outcomes.json')['outcomes'] for skill in item['skills']}


@cache
def misconceptions():
    return {item['id']: Misconception(item['id'], tuple(item['outcomes']), item['description'])
            for item in _load('misconceptions.json')['items']}


def subtopic_of(outcome_code):
    outcome = outcomes().get(outcome_code)
    return outcome.subtopic if outcome else outcome_code.rsplit('.', 1)[0]


def catalogue_errors():
    """Return readable problems; an empty list means the catalogues are consistent."""
    errors = []
    raw_outcomes = _load('outcomes.json')['outcomes']
    codes = [item['code'] for item in raw_outcomes]
    errors += [f'Duplicate outcome {code}' for code in set(codes) if codes.count(code) > 1]
    skills = [skill for item in raw_outcomes for skill in item['skills']]
    errors += [f'Skill {skill} maps to more than one outcome' for skill in set(skills) if skills.count(skill) > 1]
    subtopics = _load('outcomes.json')['subtopics']
    errors += [f'Outcome {item["code"]} has unknown subtopic' for item in raw_outcomes if item['subtopic'] not in subtopics]
    raw_items = _load('misconceptions.json')['items']
    ids = [item['id'] for item in raw_items]
    errors += [f'Duplicate misconception {item}' for item in set(ids) if ids.count(item) > 1]
    for item in raw_items:
        errors += [f'Misconception {item["id"]} uses unknown outcome {code}' for code in item['outcomes'] if code not in codes]
    return errors
