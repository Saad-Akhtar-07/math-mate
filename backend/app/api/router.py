"""Top-level API router assembled from feature route modules."""

from fastapi import APIRouter

from .routes import assessments, questions, responses, tutoring, uploads

api_router = APIRouter()
for router in (
    questions.router,
    responses.router,
    uploads.router,
    assessments.router,
    tutoring.router,
):
    api_router.include_router(router)
