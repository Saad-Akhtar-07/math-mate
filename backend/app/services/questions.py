"""Question-bank reads and mark-scheme lookup."""

import os
import threading
import time

from fastapi import HTTPException
from psycopg.rows import dict_row

from ..db.connection import connect
from .question_content import public_question, find_part


CONTENT_CACHE_SECONDS = float(os.getenv('MATH_MATE_CONTENT_CACHE_SECONDS', '300'))
_content_cache = {}
_cache_guard = threading.Lock()
_cache_load_locks = {}


def clear_content_cache():
    """Forget public content cached by this backend process."""
    with _cache_guard:
        _content_cache.clear()


def _cached(key, load):
    """Return one fresh value per key and collapse simultaneous cache misses."""
    now = time.monotonic()
    with _cache_guard:
        cached = _content_cache.get(key)
        if cached and cached[0] > now:
            return cached[1]
        load_lock = _cache_load_locks.setdefault(key, threading.Lock())

    with load_lock:
        now = time.monotonic()
        with _cache_guard:
            cached = _content_cache.get(key)
            if cached and cached[0] > now:
                return cached[1]
        value = load()
        if CONTENT_CACHE_SECONDS > 0:
            with _cache_guard:
                _content_cache[key] = (time.monotonic() + CONTENT_CACHE_SECONDS, value)
        return value


def health():
    with connect(autocommit=True) as connection:
        value = connection.execute("select 1").fetchone()[0]
    return {"status": "ok" if value == 1 else "error"}


def question_summary():
    def load():
        # Aggregate in Postgres so the summary is one small row instead of the
        # full topic/subtopic columns for every question.
        with connect(autocommit=True) as connection:
            topic_counts, subtopic_counts = connection.execute('''
                with topic_totals as (
                    select topic_code, count(*)::integer as question_count
                    from math_mate.questions group by topic_code
                ), subtopic_totals as (
                    select subtopic_code, count(*)::integer as question_count
                    from math_mate.questions
                    cross join lateral unnest(subtopic_codes) as subtopic_code
                    group by subtopic_code
                )
                select
                    coalesce((select jsonb_object_agg(topic_code, question_count) from topic_totals), '{}'::jsonb),
                    coalesce((select jsonb_object_agg(subtopic_code, question_count) from subtopic_totals), '{}'::jsonb)
            ''').fetchone()
        return {"topic_counts": topic_counts, "subtopic_counts": subtopic_counts}

    return _cached(('summary',), load)


def topic_questions(topic_code: str):
    def load():
        with connect(autocommit=True) as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute("""
                    select id, topic_code, subtopic_codes, source_file, question_data, collection_data
                    from math_mate.questions where topic_code = %s
                    order by paper_year desc, paper_session, paper_component, question_number
                """, (topic_code,))
                rows = cursor.fetchall()
        questions = [public_question(row) for row in rows]
        return {"questions": questions, "total_marks": sum(
            question.get("total_marks") or question.get("marks") or 0 for question in questions
        )}

    return _cached(('topic', topic_code), load)


def question_part_solution(part_id: str):
    segments = part_id.split("-")
    candidates = ["-".join(segments[:length]) for length in range(len(segments), 0, -1)]
    with connect(autocommit=True) as connection:
        row = connection.execute(
            "select question_data from math_mate.questions where id = any(%s) order by length(id) desc limit 1",
            (candidates,),
        ).fetchone()
    if row:
        part = find_part(row[0], part_id)
        if part is None:
            raise HTTPException(status_code=404, detail="Question part not found")
        scheme = part.get("mark_scheme") or {}
        points = [*(scheme.get("official_award_structure") or []), *(scheme.get("official_partial_marks") or [])]
        return {
            "answer": scheme.get("answer") or "See the marking points below.",
            "marking_points": [{"code": point.get("code") or "", "text": point.get("text") or ""} for point in points],
        }
    raise HTTPException(status_code=404, detail="Question part not found")
