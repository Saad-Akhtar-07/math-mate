"""Question-bank API backed by Supabase PostgreSQL."""

import copy
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row

from db import connect


app = FastAPI(title="Math Mate API")
origins = [origin.strip() for origin in os.getenv("MATH_MATE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET"], allow_headers=["*"])


def leaf_parts(part, parent_prompts=None, parent_labels=None):
    prompts = [*(parent_prompts or []), *(part.get("prompt") or [])]
    labels = [*(parent_labels or []), *([part["label"]] if part.get("label") else [])]
    if part.get("parts"):
        return [leaf for child in part["parts"] for leaf in leaf_parts(child, prompts, labels)]
    clean = {key: value for key, value in part.items() if key != "mark_scheme"}
    clean.update({
        "label": "".join(labels) or "Answer",
        "prompt": prompts,
        "subtopicCode": (part.get("bank_alignment") or {}).get("subtopic_code") or (part.get("classification") or {}).get("subtopic_code"),
    })
    return [clean]


def public_question(row):
    source = row["collection_data"]["source"]
    original = row["question_data"]
    question = {key: copy.deepcopy(value) for key, value in original.items() if key != "mark_scheme"}
    raw_parts = original.get("parts") or [{
        **original,
        "id": f"{original['id']}-main",
        "label": "Answer",
        "marks": original.get("marks", original.get("total_marks")),
        "prompt": [],
    }]
    parts = [leaf for part in raw_parts for leaf in leaf_parts(part)]
    question.update({
        "parts": parts,
        "topicCode": row["topic_code"],
        "subtopicCodes": row["subtopic_codes"],
        "paper": {
            "year": source["year"],
            "session": source["session"],
            "component": source["component"],
            "calculatorAllowed": source["calculator_allowed"],
            "file": row["source_file"],
        },
        # Submissions, uploads, and AI review have not been implemented yet.
        "localDraftOnly": True,
    })
    return question


def find_part(question, part_id):
    for part in question.get("parts") or []:
        if part.get("parts"):
            found = find_part(part, part_id)
            if found:
                return found
        elif part.get("id") == part_id:
            return part
    if not question.get("parts") and part_id == f"{question['id']}-main":
        return question
    return None


@app.get("/api/v1/health")
def health():
    with connect() as connection:
        value = connection.execute("select 1").fetchone()[0]
    return {"status": "ok" if value == 1 else "error"}


@app.get("/api/v1/questions/summary")
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


@app.get("/api/v1/topics/{topic_code}/questions")
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


@app.get("/api/v1/question-parts/{part_id}/solution")
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
