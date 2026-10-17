"""Question-bank reads and mark-scheme lookup."""

from fastapi import HTTPException
from psycopg.rows import dict_row

from ..db.connection import connect
from .question_content import public_question, find_part


def health():
    with connect() as connection:
        value = connection.execute("select 1").fetchone()[0]
    return {"status": "ok" if value == 1 else "error"}


def question_summary():
    topic_counts = {}
    subtopic_counts = {}
    with connect() as connection:
        rows = connection.execute("select topic_code, subtopic_codes from math_mate.questions").fetchall()
    for topic_code, codes in rows:
        topic_counts[topic_code] = topic_counts.get(topic_code, 0) + 1
        for code in codes:
            subtopic_counts[code] = subtopic_counts.get(code, 0) + 1
    return {"topic_counts": topic_counts, "subtopic_counts": subtopic_counts}


def topic_questions(topic_code: str):
    with connect() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("""
                select id, topic_code, subtopic_codes, source_file, question_data, collection_data
                from math_mate.questions where topic_code = %s
                order by paper_year desc, paper_session, paper_component, question_number
            """, (topic_code,))
            rows = cursor.fetchall()
    questions = [public_question(row) for row in rows]
    return {"questions": questions, "total_marks": sum(question.get("total_marks") or question.get("marks") or 0 for question in questions)}


def question_part_solution(part_id: str):
    segments = part_id.split("-")
    candidates = ["-".join(segments[:length]) for length in range(len(segments), 0, -1)]
    with connect() as connection:
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
