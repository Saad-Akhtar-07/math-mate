"""Public question-bank and health endpoints."""

from fastapi import APIRouter, Request, Response

from ...services import questions

router = APIRouter(prefix='/api/v1')
PUBLIC_CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400'


def public_payload(request: Request, response: Response, payload):
    etag = questions.etag_for(payload)
    headers = {'Cache-Control': PUBLIC_CACHE_CONTROL, 'ETag': etag, 'Vary': 'Accept-Encoding'}
    if request.headers.get('if-none-match') == etag:
        return Response(status_code=304, headers=headers)
    for name, value in headers.items():
        response.headers[name] = value
    return payload


@router.get('/health')
def health():
    return questions.health()


@router.get('/questions/summary')
def question_summary(request: Request, response: Response):
    return public_payload(request, response, questions.question_summary())


@router.get('/topics/{topic_code}/questions')
def topic_questions(topic_code: str, request: Request, response: Response):
    """Compatibility endpoint for older clients; new clients use catalogue + detail."""
    return public_payload(request, response, questions.topic_questions(topic_code))


@router.get('/topics/{topic_code}/questions/catalogue')
def topic_catalogue(topic_code: str, request: Request, response: Response):
    return public_payload(request, response, questions.topic_catalogue(topic_code))


@router.get('/questions/{question_id}')
def question_detail(question_id: str, request: Request, response: Response):
    return public_payload(request, response, questions.question_detail(question_id))


@router.get('/question-parts/{part_id}/solution')
def question_part_solution(part_id: str):
    return questions.question_part_solution(part_id)
