"""Fast unit checks for the public question catalogue service."""

from contextlib import contextmanager

from backend.app.services import questions


class SummaryResult:
    def fetchone(self):
        return {'1': 12, '2': 181}, {'1.1': 4, '2.1': 27}


class SummaryConnection:
    def __init__(self):
        self.statements = []

    def execute(self, statement):
        self.statements.append(statement)
        return SummaryResult()


def test_summary_is_aggregated_once_and_cached(monkeypatch):
    connection = SummaryConnection()
    checkouts = []

    @contextmanager
    def fake_connect(autocommit=False):
        checkouts.append(autocommit)
        yield connection

    monkeypatch.setattr(questions, 'connect', fake_connect)
    monkeypatch.setattr(questions, 'CONTENT_CACHE_SECONDS', 300)
    questions.clear_content_cache()
    try:
        expected = {
            'topic_counts': {'1': 12, '2': 181},
            'subtopic_counts': {'1.1': 4, '2.1': 27},
        }
        assert questions.question_summary() == expected
        assert questions.question_summary() == expected
    finally:
        questions.clear_content_cache()

    assert checkouts == [True]
    assert len(connection.statements) == 1
    assert 'jsonb_object_agg' in connection.statements[0]
    assert 'unnest(subtopic_codes)' in connection.statements[0]


def test_catalogue_omits_heavy_prompts_but_keeps_navigation_parts(monkeypatch):
    full = {'questions': [{
        'id': 'q1', 'number': 1, 'title': 'Solve', 'total_marks': 2,
        'difficulty': {'label': 'easy'}, 'topicCode': '2', 'subtopicCodes': ['2.5'],
        'paper': {'year': 2024}, 'prompt': [{'type': 'paragraph', 'content': 'large prompt'}],
        'capabilities': {'saveResponses': True}, 'uploadLimits': {'maxPages': 4},
        'parts': [{'id': 'q1-a', 'label': '(a)', 'marks': 2, 'subtopicCode': '2.5',
                   'prompt': [{'type': 'paragraph', 'content': 'part prompt'}]}],
    }], 'total_marks': 2}
    monkeypatch.setattr(questions, 'topic_questions', lambda _topic: full)
    questions.clear_content_cache()
    try:
        catalogue = questions.topic_catalogue('2')
    finally:
        questions.clear_content_cache()
    item = catalogue['questions'][0]
    assert 'prompt' not in item
    assert item['parts'] == [{'id': 'q1-a', 'label': '(a)', 'marks': 2, 'subtopicCode': '2.5'}]
    assert len(str(catalogue)) < len(str(full))


def test_liveness_check_never_checks_out_a_database_connection(monkeypatch):
    def unexpected_connect(*_args, **_kwargs):
        raise AssertionError('liveness must not consume a database connection')

    monkeypatch.setattr(questions, 'connect', unexpected_connect)
    assert questions.health() == {'status': 'ok'}


def test_readiness_check_verifies_the_database(monkeypatch):
    connection = SummaryConnection()
    connection.execute = lambda _statement: type('Result', (), {'fetchone': lambda _self: (1,)})()

    @contextmanager
    def fake_connect(autocommit=False):
        assert autocommit is True
        yield connection

    monkeypatch.setattr(questions, 'connect', fake_connect)
    assert questions.readiness() == {'status': 'ok'}
