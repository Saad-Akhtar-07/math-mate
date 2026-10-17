"""Public question-bank and health endpoints."""

from fastapi import APIRouter

from ...services import questions

router = APIRouter(prefix='/api/v1')


@router.get('/health')
def health():
    return questions.health()


@router.get('/questions/summary')
def question_summary():
    return questions.question_summary()


@router.get('/topics/{topic_code}/questions')
def topic_questions(topic_code: str):
    return questions.topic_questions(topic_code)


@router.get('/question-parts/{part_id}/solution')
def question_part_solution(part_id: str):
    return questions.question_part_solution(part_id)
