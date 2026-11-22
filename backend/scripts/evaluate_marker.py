"""Evaluate the Marker against the golden set. Replays recorded outputs by default, at no cost.

    python -m backend.scripts.evaluate_marker            # replay recordings for the current prompt version
    python -m backend.scripts.evaluate_marker --fake     # exercise the pipeline with the free fake provider
    python -m backend.scripts.evaluate_marker --record --max-requests 10
        # LIVE: one request per attempt without a recording, no repairs. Needs MATH_MATE_AI_PROVIDER=deepseek
        # and the owner's approval of the batch size and cost first (see AGENTS.md).
"""

import argparse
import json
import os
import sys

from ..app.ai import gateway
from ..app.ai.prompts import prompt
from ..app.ai.types import AIError, InvalidOutput, LLMRequest
from ..app.core.config import PROJECT_ROOT, ai_settings
from ..app.tutoring import marker
from ..app.tutoring.leak_guard import normalise
from ..app.tutoring.mark_rules import validate
from ..app.tutoring.part_context import build_part_context

# Tracked in git (data/ is ignored). Recordings hold model output only, never student work.
GOLDEN = PROJECT_ROOT / 'backend/evaluation/marker_golden.json'
RECORDINGS = PROJECT_ROOT / 'backend/evaluation/recordings'


class FreeLedger:
    """Fake-provider runs cost nothing, so they need no database budget ledger."""
    def reserve(self, *_args):
        return None

    def settle(self, *_args):
        pass


def contexts(part_ids):
    found = {}
    for path in sorted((PROJECT_ROOT / 'data').rglob('*.json')):
        for question in json.loads(path.read_text(encoding='utf-8'))['questions']:
            for part_id in part_ids - found.keys():
                try:
                    found[part_id] = build_part_context(question, part_id)
                except KeyError:
                    pass
    return found


def request_for(context, attempt):
    return LLMRequest('marker', marker.build_messages(context, attempt['typed_work'], []), ai_settings().marker_max_tokens,
                      prompt('marker').version, thinking=True, reasoning_effort=ai_settings().marker_reasoning_effort)


def same_step(expected, mistakes):
    if expected is None:
        return not mistakes
    return bool(mistakes) and normalise(expected) in normalise(mistakes[0].student_step)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--record', action='store_true')
    parser.add_argument('--fake', action='store_true')
    parser.add_argument('--max-requests', type=int, default=0)
    args = parser.parse_args()
    attempts = json.loads(GOLDEN.read_text(encoding='utf-8'))['attempts']
    by_part = contexts({attempt['part_id'] for attempt in attempts})
    recording_file = RECORDINGS / f"{prompt('marker').version}.json"
    recorded = json.loads(recording_file.read_text(encoding='utf-8')) if recording_file.exists() else {}

    if args.fake:
        os.environ['MATH_MATE_AI_PROVIDER'] = 'fake'
        gateway.ledger = FreeLedger()
        outputs = {attempt['id']: gateway.call(request_for(by_part[attempt['part_id']], attempt)).content for attempt in attempts}
    else:
        outputs = dict(recorded)
        missing = [attempt for attempt in attempts if attempt['id'] not in recorded]
        if args.record and missing:
            if ai_settings().provider != 'deepseek' or args.max_requests < len(missing):
                sys.exit(f'Recording needs MATH_MATE_AI_PROVIDER=deepseek and --max-requests >= {len(missing)} (approved batch).')
            for attempt in missing:
                try:
                    outputs[attempt['id']] = gateway.call(request_for(by_part[attempt['part_id']], attempt)).content
                except AIError as error:
                    print(f"{attempt['id']}: request failed ({error.code}); stopping without retrying.")
                    break
            RECORDINGS.mkdir(parents=True, exist_ok=True)
            recording_file.write_text(json.dumps(outputs, indent=1, ensure_ascii=False), encoding='utf-8')

    rows, exact, close, error_sum, steps, violations = [], 0, 0, 0, 0, 0
    for attempt in attempts:
        content = outputs.get(attempt['id'])
        if content is None:
            rows.append(f"{attempt['id']:<20} no recording")
            continue
        try:
            result, problems = validate(marker.parse(content), by_part[attempt['part_id']])
        except InvalidOutput:
            result, problems = None, ['invalid JSON shape']
        if not result:
            violations += 1
            rows.append(f"{attempt['id']:<20} rule violations: {'; '.join(problems)[:80]}")
            continue
        difference = abs((result.marks_awarded or 0) - attempt['expected_marks'])
        exact += difference == 0
        close += difference <= 1
        error_sum += difference
        steps += same_step(attempt['expected_first_mistake'], result.output.mistakes)
        rows.append(f"{attempt['id']:<20} marker {result.marks_awarded} / expected {attempt['expected_marks']}")
    scored = len(attempts) - sum('no recording' in row for row in rows) - violations
    print('\n'.join(rows))
    if scored:
        print(f'\nScored {scored}/{len(attempts)}: exact {exact / scored:.0%}, within 1 mark {close / scored:.0%}, '
              f'mean absolute error {error_sum / scored:.2f}, first-mistake agreement {steps / scored:.0%}, '
              f'rule violations {violations}. Prompt {prompt("marker").version}.')


if __name__ == '__main__':
    main()
