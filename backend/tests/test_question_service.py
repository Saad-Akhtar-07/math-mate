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
