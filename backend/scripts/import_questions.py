"""Validate and upsert all curated question JSON into Supabase PostgreSQL."""

import argparse
import json

from psycopg.types.json import Jsonb

from ..app.db.connection import connect
from ..app.core.config import PROJECT_ROOT


ROOT = PROJECT_ROOT
DATA_DIR = ROOT / "data"
MIGRATION = ROOT / "supabase/migrations/20261015000000_question_bank.sql"
TOPIC_BY_NAME = {"algebra and graphs": "2"}


def first_leaf(part):
    while part and part.get("parts"):
        part = part["parts"][0]
    return part or {}


def leaves(part):
    children = part.get("parts") or []
    if children:
        for child in children:
            yield from leaves(child)
    else:
        yield part


def topic_code_for(collection, question):
    syllabus = collection.get("syllabus") or {}
    leaf = first_leaf((question.get("parts") or [{}])[0])
    direct = (
        (syllabus.get("topic") or {}).get("code")
        or (syllabus.get("target_bank") or {}).get("topic_code")
        or (question.get("classification") or {}).get("topic_code")
        or (question.get("bank_alignment") or {}).get("topic_code")
        or (leaf.get("bank_alignment") or {}).get("topic_code")
        or (leaf.get("classification") or {}).get("topic_code")
    )
    if direct:
        return str(direct)
    name = (syllabus.get("target_bank") or {}).get("name") or (question.get("classification") or {}).get("topic_name")
    return TOPIC_BY_NAME.get(str(name).lower())


def subtopic_codes_for(question):
    parts = question.get("parts") or [question]
    codes = []
    for part in parts:
        for leaf in leaves(part):
            code = (leaf.get("bank_alignment") or {}).get("subtopic_code") or (leaf.get("classification") or {}).get("subtopic_code")
            if code and str(code) not in codes:
                codes.append(str(code))
    return codes


def read_rows():
    files = sorted(DATA_DIR.glob("*.json"))
    if not files:
        raise ValueError(f"No JSON files found in {DATA_DIR}")
    rows = []
    ids = set()
    paper_numbers = set()
    for path in files:
        paper = json.loads(path.read_text(encoding="utf-8"))
        collection = paper.get("collection") or {}
        source = collection.get("source") or {}
        questions = paper.get("questions")
        if not collection.get("id") or not isinstance(questions, list) or not source:
            raise ValueError(f"Invalid collection or questions in {path.name}")
        for question in questions:
            question_id = question.get("id")
            number = question.get("number")
            topic_code = topic_code_for(collection, question)
            total_marks = question.get("total_marks", question.get("marks"))
            paper_key = (collection["id"], number)
            if not question_id or not isinstance(number, int) or not topic_code or not isinstance(total_marks, int):
                raise ValueError(f"Missing question ID, number, topic, or marks in {path.name}")
            if question_id in ids or paper_key in paper_numbers:
                raise ValueError(f"Duplicate question ID or paper number: {question_id}")
            for top_part in question.get("parts") or []:
                for part in leaves(top_part):
                    if not str(part.get("id", "")).startswith(f"{question_id}-"):
                        raise ValueError(f"Part ID does not begin with its question ID: {question_id}")
            for field in ("year", "session", "component", "calculator_allowed"):
                if field not in source:
                    raise ValueError(f"Missing source.{field} in {path.name}")
            ids.add(question_id)
            paper_numbers.add(paper_key)
            rows.append({
                "id": question_id,
                "collection_id": collection["id"],
                "source_file": path.name,
                "topic_code": topic_code,
                "subtopic_codes": subtopic_codes_for(question),
                "question_number": number,
                "title": question.get("title"),
                "total_marks": total_marks,
                "difficulty_rank": (question.get("difficulty") or {}).get("rank"),
                "paper_year": source["year"],
                "paper_session": source["session"],
                "paper_component": str(source["component"]),
                "calculator_allowed": source["calculator_allowed"],
                "question_data": question,
                "collection_data": collection,
            })
    return files, rows


UPSERT = """
insert into math_mate.questions (
    id, collection_id, source_file, topic_code, subtopic_codes, question_number,
    title, total_marks, difficulty_rank, paper_year, paper_session,
    paper_component, calculator_allowed, question_data, collection_data
) values (
    %(id)s, %(collection_id)s, %(source_file)s, %(topic_code)s, %(subtopic_codes)s,
    %(question_number)s, %(title)s, %(total_marks)s, %(difficulty_rank)s,
    %(paper_year)s, %(paper_session)s, %(paper_component)s,
    %(calculator_allowed)s, %(question_data)s, %(collection_data)s
)
on conflict (id) do update set
    collection_id = excluded.collection_id,
    source_file = excluded.source_file,
    topic_code = excluded.topic_code,
    subtopic_codes = excluded.subtopic_codes,
    question_number = excluded.question_number,
    title = excluded.title,
    total_marks = excluded.total_marks,
    difficulty_rank = excluded.difficulty_rank,
    paper_year = excluded.paper_year,
    paper_session = excluded.paper_session,
    paper_component = excluded.paper_component,
    calculator_allowed = excluded.calculator_allowed,
    question_data = excluded.question_data,
    collection_data = excluded.collection_data,
    updated_at = now()
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create the first table if needed and write all questions")
    args = parser.parse_args()
    files, rows = read_rows()
    print(f"Validated {len(rows)} questions from {len(files)} JSON files.")
    if not args.apply:
        print("Dry run only. Use --apply to write to Supabase.")
        return

    with connect() as connection:
        if connection.execute("select to_regclass('math_mate.questions')").fetchone()[0] is None:
            connection.execute(MIGRATION.read_text(encoding="utf-8"))
        with connection.cursor() as cursor:
            cursor.executemany(UPSERT, [
                {**row, "question_data": Jsonb(row["question_data"]), "collection_data": Jsonb(row["collection_data"])}
                for row in rows
            ])
            cursor.execute("select id, question_data, collection_data from math_mate.questions where id = any(%s)", ([row["id"] for row in rows],))
            stored = {question_id: (question, collection) for question_id, question, collection in cursor.fetchall()}
            for row in rows:
                if stored.get(row["id"]) != (row["question_data"], row["collection_data"]):
                    raise RuntimeError(f"Verification failed for {row['id']}; import rolled back")
            cursor.execute("select count(*) from math_mate.questions")
            total = cursor.fetchone()[0]
    print(f"Imported and verified {len(rows)} full JSON questions. Database total: {total}.")


if __name__ == "__main__":
    main()
