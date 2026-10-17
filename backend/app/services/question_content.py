"""Student-safe projections of curated question documents."""

import copy
from ..core.config import storage_configured


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
        "localDraftOnly": False,
        "capabilities": {"saveResponses": True, "submitResponses": True, "uploads": storage_configured(), "aiTutor": False},
        "uploadLimits": {"maxPages": 4, "maxFileBytes": 10485760, "acceptedTypes": ["image/jpeg", "image/png", "image/webp"]},
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
