"""FastAPI application assembly and resource lifecycle."""

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.routes import questions, responses, sessions, uploads
from .core.config import cors_origins
from .db.connection import start_pool, stop_pool
from .middleware.upload_limits import UploadBodyLimit
from .services.storage import StorageError


@asynccontextmanager
async def lifespan(_app):
    start_pool()
    try:
        yield
    finally:
        stop_pool()


app = FastAPI(title='Math Mate API', lifespan=lifespan)
for router in (questions.router, sessions.router, responses.router, uploads.router):
    app.include_router(router)
app.add_middleware(UploadBodyLimit)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_methods=['GET', 'POST', 'PUT', 'DELETE'],
    allow_headers=['Content-Type', 'Authorization'],
)


@app.exception_handler(StorageError)
async def storage_error(_request, error):
    logging.getLogger(__name__).warning('Storage operation failed: %s', error)
    return JSONResponse(
        status_code=503,
        content={'detail': 'Photos are temporarily unavailable. Please try again later.'},
        headers={'Cache-Control': 'no-store'},
    )
