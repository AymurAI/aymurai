import contextlib
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, StaticPool, create_engine

from aymurai.api.endpoints.routers.llm import summarization, summary_validation
from aymurai.api.endpoints.routers.llm.summarization_engine import ContextBudget
from aymurai.database.session import get_session

SUMMARIZATION_MODULE = "aymurai.api.endpoints.routers.llm.summarization"


def parse_sse(body: str) -> list[dict]:
    events = []
    for block in body.split("\n\n"):
        block = block.strip()
        if not block.startswith("data:"):
            continue
        events.append(json.loads(block[len("data:") :].strip()))
    return events


def fake_budget(**overrides) -> ContextBudget:
    defaults = {
        "effective_ctx": 1000,
        "scaffold_first": 10,
        "scaffold_rolling": 10,
        "reserved_output": 100,
    }
    defaults.update(overrides)
    return ContextBudget(**defaults)


def fake_prepare_run(*, calls=None, raises=None):
    """
    Double for `prepare_run`: returns a stub provider whose `model_name`
    mirrors whatever `model` was requested (mimicking the real
    explicit-override-wins behavior) without ever touching the network.
    """

    async def _prepare_run(model, *, system_prompt, rolling_system_prompt, max_tokens):
        if raises is not None:
            raise raises
        if calls is not None:
            calls.append(
                {
                    "model": model,
                    "system_prompt": system_prompt,
                    "rolling_system_prompt": rolling_system_prompt,
                    "max_tokens": max_tokens,
                }
            )
        provider = MagicMock()
        provider.model_name = model or "/models/fake-served.gguf"
        provider.aclose = AsyncMock()
        return provider, fake_budget()

    return _prepare_run


def fake_summarize_events(events, *, calls=None):
    """Double for `summarize_events`: yields a fixed event sequence."""

    async def _summarize_events(
        provider, *, text, budget, options, system_prompt, rolling_system_prompt
    ):
        if calls is not None:
            calls.append(
                {"text": text, "options": options, "system_prompt": system_prompt}
            )
        for event in events:
            yield event

    return _summarize_events


@contextlib.contextmanager
def patched_generation(
    events, *, prepare_calls=None, event_calls=None, prepare_raises=None
):
    """Patch the router's provider construction and generation with doubles."""
    with (
        patch(
            f"{SUMMARIZATION_MODULE}.prepare_run",
            new=fake_prepare_run(calls=prepare_calls, raises=prepare_raises),
        ),
        patch(
            f"{SUMMARIZATION_MODULE}.summarize_events",
            new=fake_summarize_events(events, calls=event_calls),
        ),
    ):
        yield


def fake_llamacpp_network(n_ctx=100_000, n_ctx_train=131_072):
    """
    Double for the raw httpx client (`/tokenize`, `/apply-template`) and the
    OpenAI SDK client's `models.list()`/`get()`, generic enough that a test
    can exercise the real `prepare_run`/`summarize_events` path — the actual
    llama.cpp wiring — without depending on call order or count.
    """

    async def _post(url, json=None, **kwargs):
        if url == "/apply-template":
            payload = {"prompt": "<rendered>"}
        else:
            content = (json or {}).get("content", "") or ""
            words = content.split() or ["x"]
            if json and json.get("with_pieces"):
                payload = {
                    "tokens": [{"id": i, "piece": w} for i, w in enumerate(words)]
                }
            else:
                payload = {"tokens": list(range(len(words)))}
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: payload)

    mock_raw_client = MagicMock()
    mock_raw_client.post = AsyncMock(side_effect=_post)
    mock_raw_client.aclose = AsyncMock()

    async def _models_page():
        yield SimpleNamespace(
            id="/models/real-model.gguf",
            model_extra={"meta": {"n_ctx": n_ctx, "n_ctx_train": n_ctx_train}},
        )

    mock_openai_client = MagicMock()
    mock_openai_client.models.list = AsyncMock(return_value=_models_page())
    mock_openai_client.get = AsyncMock(return_value={"models": []})
    mock_openai_client.close = AsyncMock()

    return mock_openai_client, mock_raw_client


@pytest.fixture
def llm_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def llm_test_client(llm_engine):
    app = FastAPI()
    app.include_router(summarization.router, prefix="/llm")
    app.include_router(summary_validation.router, prefix="/llm")

    def _override_get_session():
        with Session(llm_engine) as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
