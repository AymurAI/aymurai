import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from aymurai.api.endpoints.routers.llm import summarization


@pytest.fixture
def llm_test_client():
    app = FastAPI()
    app.include_router(summarization.router, prefix="/llm")
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
