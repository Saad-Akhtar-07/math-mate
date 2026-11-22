"""FastAPI application assembly and resource lifecycle."""

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg_pool import PoolTimeout

from .api.router import api_router
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
app.include_router(api_router)
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


@app.exception_handler(PoolTimeout)
async def database_busy(_request, _error):
    logging.getLogger(__name__).warning('Database connection pool is temporarily busy')
    return JSONResponse(
        status_code=503,
        content={'detail': 'The question service is busy. Please try again shortly.'},
        headers={'Cache-Control': 'no-store', 'Retry-After': '1'},
    )
