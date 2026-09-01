import contextlib
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, StaticPool, create_engine

from aymurai.api.v1.routers import data_extraction
from aymurai.database.schema import OrganigramUnit
from aymurai.database.session import _enable_sqlite_foreign_keys, get_session
from aymurai.llm_providers import LLMResponse, ServedModel
from aymurai.settings import settings

DATA_EXTRACTION_MODULE = "aymurai.api.v1.routers.data_extraction"


class FakeProvider:
    """
    Provider double for `LlamaCppLLMProvider`: scripted `async_generate`
    replies, fixed token counting, no network. Records every system prompt
    sent so tests can assert on retry (non-)accumulation.
    """

    def __init__(
        self, responses: list[str], *, n_ctx: int = 65536, tokens_per_call: int = 100
    ):
        self.model_name = "fake-model"
        self._responses = list(responses)
        self.sent_system_prompts: list[str] = []
        self._n_ctx = n_ctx
        self._tokens_per_call = tokens_per_call
        self.aclose = AsyncMock()

    async def aresolve_served_model(self) -> ServedModel:
        return ServedModel(
            id=self.model_name, n_ctx=self._n_ctx, n_ctx_train=self._n_ctx
        )

    async def acount_prompt_tokens(self, *, messages) -> int:
        del messages
        return self._tokens_per_call

    async def async_generate(self, *, messages, **kwargs) -> LLMResponse:
        del kwargs
        self.sent_system_prompts.append(messages[0]["content"])
        return LLMResponse(text=self._responses.pop(0))


@contextlib.contextmanager
def patched_provider(provider: FakeProvider):
    """Patch the router's provider construction with a scripted double."""
    with patch(f"{DATA_EXTRACTION_MODULE}.LlamaCppLLMProvider", return_value=provider):
        yield


@pytest.fixture(autouse=True)
def _llamacpp_base_url(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")


@pytest.fixture(autouse=True)
def _fuzzy_only_organigram_matching(monkeypatch):
    # resolve_recipient_unit (called for every recipient in every response)
    # always reads settings.DATA_EXTRACTION_SEARCH_BACKEND -- force "fuzzy" so
    # this test suite never loads the real sentence-transformers model.
    monkeypatch.setattr(settings, "DATA_EXTRACTION_SEARCH_BACKEND", "fuzzy")


@pytest.fixture
def extraction_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    from sqlalchemy import event

    event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def extraction_client(extraction_engine):
    app = FastAPI()
    app.include_router(data_extraction.router, prefix="/llm")

    def _override_get_session():
        with Session(extraction_engine) as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def second_extraction_client(extraction_engine):
    """A second app/client wired to the *same* engine -- simulates a second
    connected client, for multi-client persistence tests."""
    app = FastAPI()
    app.include_router(data_extraction.router, prefix="/llm")

    def _override_get_session():
        with Session(extraction_engine) as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def seeded_organigram_unit(extraction_engine):
    """One active organigram unit, marked as its own sector."""
    with Session(extraction_engine) as session:
        unit = OrganigramUnit(
            id=uuid.uuid4(), name="Ministerio de Salud", is_sector=True
        )
        session.add(unit)
        session.commit()
        session.refresh(unit)
        return unit


@pytest.fixture
def seeded_catalogs(extraction_engine):
    """Seeds one topic/subtopic pair and the 4 macro sectors."""
    from aymurai.database.crud.catalogs.subtopic import subtopic_create
    from aymurai.database.crud.catalogs.topic import topic_create
    from aymurai.database.schema import SubtopicCreate, TopicCreate
    from aymurai.database.seed.catalogs import seed_macro_sectors

    with Session(extraction_engine) as session:
        topic = topic_create(TopicCreate(code="SALUD", name="SALUD"), session)
        subtopic_create(
            SubtopicCreate(topic_id=topic.id, code="SALUD1", name="Hospitales"), session
        )
        seed_macro_sectors(session)

    return {"SALUD": ["Hospitales"]}
