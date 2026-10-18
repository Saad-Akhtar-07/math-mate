"""Generate the backend outcome registry from frontend/src/data/syllabus.js. Defaults to a check.

The frontend syllabus holds the official outcome wording; the backend ships its own copy
because the deployed service contains only backend/. Skill aliases already in the
registry are kept. Run with --apply after changing syllabus outcomes.
"""

import argparse
import json
import sys

from ..app.core.config import PROJECT_ROOT
from ..app.tutoring.catalogue import CATALOGUE

SYLLABUS = PROJECT_ROOT / 'frontend/src/data/syllabus.js'
REGISTRY = CATALOGUE / 'outcomes.json'


def syllabus_topics():
    text = SYLLABUS.read_text(encoding='utf-8')
    marker = 'export const syllabus = '
    start = text.index(marker) + len(marker)
    return json.loads(text[start:text.index('\n\nexport const syllabusMeta')])


def outcome_code(subtopic, index):
    # A subtopic with one outcome uses its own code, as in data/*.json ("2.8", "2.11").
    return subtopic['code'] if len(subtopic['outcomes']) == 1 else f"{subtopic['code']}.{index}"


def generated(current):
    skills = {item['code']: item['skills'] for item in current['outcomes']}
    topics = syllabus_topics()
    outcomes = [{'code': outcome_code(subtopic, index), 'subtopic': subtopic['code'], 'text': text,
                 'skills': skills.get(outcome_code(subtopic, index), [])}
                for topic in topics for subtopic in topic['subtopics']
                for index, text in enumerate(subtopic['outcomes'], 1)]
    return {
        'version': current['version'],
        'source': current['source'],
        'review_status': current['review_status'],
        'subtopics': {subtopic['code']: subtopic['title'] for topic in topics for subtopic in topic['subtopics']},
        'outcomes': outcomes,
    }


def render(registry):
    head = {key: value for key, value in registry.items() if key != 'outcomes'}
    lines = ',\n'.join(f'    {json.dumps(item, ensure_ascii=False)}' for item in registry['outcomes'])
    body = json.dumps(head, indent=2, ensure_ascii=False)[:-2]
    return f'{body},\n  "outcomes": [\n{lines}\n  ]\n}}\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    current = json.loads(REGISTRY.read_text(encoding='utf-8'))
    expected = generated(current)
    lost = sorted({item['code'] for item in current['outcomes'] if item['skills']} - {item['code'] for item in expected['outcomes']})
    if lost:
        sys.exit(f'Refusing to drop outcomes that carry skill aliases: {", ".join(lost)}')
    if expected == current:
        print(f'Outcome registry is up to date ({len(expected["outcomes"])} outcomes).')
        return
    if not args.apply:
        sys.exit('Outcome registry differs from syllabus.js; run with --apply to regenerate it.')
    REGISTRY.write_text(render(expected), encoding='utf-8')
    print(f'Wrote {len(expected["outcomes"])} outcomes to {REGISTRY.relative_to(PROJECT_ROOT)}.')


if __name__ == '__main__':
    main()
