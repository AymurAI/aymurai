from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from aymurai.api.endpoints.routers.llm.summarization_engine import (
    ContextBudget,
    ContextTooSmallError,
    DoneEvent,
    EmptyCompletionError,
    StepEvent,
    TokenEvent,
    build_context_budget,
    load_rolling_prompt,
    prepare_run,
    summarize_events,
)
from aymurai.llm_providers import LLMResponse, LlamaCppLLMProvider
from aymurai.llm_providers.llamacpp_provider import ServedModel
from aymurai.llm_providers.tokens import TokenPiece
from aymurai.settings import settings


def test_first_window_budget_subtracts_scaffold_and_output():
    budget = ContextBudget(
        effective_ctx=1000, scaffold_first=40, scaffold_rolling=60, reserved_output=200
    )

    assert budget.first_window_budget == 1000 - 40 - 200


def test_rolling_window_budget_subtracts_the_measured_summary():
    budget = ContextBudget(
        effective_ctx=1000, scaffold_first=40, scaffold_rolling=60, reserved_output=200
    )

    # Measured, not worst-cased at reserved_output.
    assert budget.rolling_window_budget(150) == 1000 - 60 - 200 - 150


def test_rolling_window_budget_can_go_non_positive():
    budget = ContextBudget(
        effective_ctx=300, scaffold_first=40, scaffold_rolling=60, reserved_output=200
    )

    assert budget.rolling_window_budget(100) <= 0


@pytest.mark.anyio
async def test_build_context_budget_caps_at_the_servers_n_ctx(monkeypatch):
    monkeypatch.setattr(settings, "LLM_MAX_CONTEXT_TOKENS", None)
    provider = MagicMock()
    provider.aresolve_served_model = AsyncMock(
        return_value=ServedModel(id="m", n_ctx=2_000, n_ctx_train=131_072)
    )
    provider.acount_prompt_tokens = AsyncMock(side_effect=[50, 70, 1, 1])
    provider.atokenize = AsyncMock(return_value=[0])

    budget = await build_context_budget(
        provider, system_prompt="S", rolling_system_prompt="R", max_tokens=100
    )

    assert budget.effective_ctx == 2_000
    assert budget.reserved_output == 100


@pytest.mark.anyio
async def test_build_context_budget_honours_the_settings_cap(monkeypatch):
    monkeypatch.setattr(settings, "LLM_MAX_CONTEXT_TOKENS", 4_096)
    provider = MagicMock()
    provider.aresolve_served_model = AsyncMock(
        return_value=ServedModel(id="m", n_ctx=131_072, n_ctx_train=131_072)
    )
    provider.acount_prompt_tokens = AsyncMock(side_effect=[50, 70, 1, 1])
    provider.atokenize = AsyncMock(return_value=[0])

    budget = await build_context_budget(
        provider, system_prompt="S", rolling_system_prompt="R", max_tokens=100
    )

    assert budget.effective_ctx == 4_096


@pytest.mark.anyio
async def test_build_context_budget_falls_back_to_n_ctx_train(monkeypatch):
    monkeypatch.setattr(settings, "LLM_MAX_CONTEXT_TOKENS", None)
    provider = MagicMock()
    provider.aresolve_served_model = AsyncMock(
        return_value=ServedModel(id="m", n_ctx=None, n_ctx_train=8_192)
    )
    provider.acount_prompt_tokens = AsyncMock(side_effect=[50, 70, 1, 1])
    provider.atokenize = AsyncMock(return_value=[0])

    budget = await build_context_budget(
        provider, system_prompt="S", rolling_system_prompt="R", max_tokens=100
    )

    assert budget.effective_ctx == 8_192


@pytest.mark.anyio
async def test_build_context_budget_rejects_an_unusable_window(monkeypatch):
    monkeypatch.setattr(settings, "LLM_MAX_CONTEXT_TOKENS", None)
    provider = MagicMock()
    provider.aresolve_served_model = AsyncMock(
        return_value=ServedModel(id="m", n_ctx=100, n_ctx_train=100)
    )
    provider.acount_prompt_tokens = AsyncMock(side_effect=[80, 90, 1, 1])
    provider.atokenize = AsyncMock(return_value=[0])

    with pytest.raises(ContextTooSmallError, match="leaves no room"):
        await build_context_budget(
            provider, system_prompt="S", rolling_system_prompt="R", max_tokens=50
        )


@pytest.mark.anyio
async def test_prepare_run_adopts_the_served_model_id(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")
    monkeypatch.setattr(settings, "LLM_MAX_CONTEXT_TOKENS", None)
    served = ServedModel(id="/models/real-model.gguf", n_ctx=4096, n_ctx_train=8192)

    with (
        patch.object(
            LlamaCppLLMProvider,
            "aresolve_served_model",
            new=AsyncMock(return_value=served),
        ),
        patch.object(
            LlamaCppLLMProvider,
            "acount_prompt_tokens",
            new=AsyncMock(side_effect=[50, 70]),
        ),
        patch.object(LlamaCppLLMProvider, "atokenize", new=AsyncMock(return_value=[1])),
    ):
        provider, budget = await prepare_run(
            None, system_prompt="S", rolling_system_prompt="R", max_tokens=100
        )

    # The placeholder is replaced by the server's own identity.
    assert provider.model_name == "/models/real-model.gguf"
    assert budget.effective_ctx == 4096


@pytest.mark.anyio
async def test_prepare_run_lets_an_explicit_model_win(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")
    monkeypatch.setattr(settings, "LLM_MAX_CONTEXT_TOKENS", None)
    served = ServedModel(id="/models/real-model.gguf", n_ctx=4096, n_ctx_train=8192)

    with (
        patch.object(
            LlamaCppLLMProvider,
            "aresolve_served_model",
            new=AsyncMock(return_value=served),
        ),
        patch.object(
            LlamaCppLLMProvider,
            "acount_prompt_tokens",
            new=AsyncMock(side_effect=[50, 70]),
        ),
        patch.object(LlamaCppLLMProvider, "atokenize", new=AsyncMock(return_value=[1])),
    ):
        provider, _ = await prepare_run(
            "override", system_prompt="S", rolling_system_prompt="R", max_tokens=100
        )

    assert provider.model_name == "override"


def test_load_rolling_prompt_renders_the_template_variables():
    prompt = load_rolling_prompt(
        information_to_extract="INFO-X", entities_to_identify="ENT-Y"
    )

    assert "INFO-X" in prompt
    assert "ENT-Y" in prompt
    assert "{information_to_extract}" not in prompt


def _fake_provider(pieces, replies):
    """Provider double: fixed tokenization, scripted streamed replies."""
    provider = MagicMock()
    provider.atokenize_pieces = AsyncMock(return_value=pieces)
    provider.atokenize = AsyncMock(side_effect=lambda t, **k: [0] * len(t.split()))
    provider.acount_prompt_tokens = AsyncMock(return_value=1)
    provider.sent_prompts = []

    scripted = list(replies)

    async def _stream(prompt=None, **kwargs):
        provider.sent_prompts.append(prompt)
        for token in scripted.pop(0):
            yield LLMResponse(text=token, metadata={"finish_reason": "stop"})

    provider.async_stream = _stream
    return provider


def _budget(ctx=1000, first=10, rolling=20, out=100):
    return ContextBudget(
        effective_ctx=ctx,
        scaffold_first=first,
        scaffold_rolling=rolling,
        reserved_output=out,
    )


async def _collect(provider, budget, pieces_text="uno dos tres"):
    events = []
    async for event in summarize_events(
        provider,
        text=pieces_text,
        budget=budget,
        options={"max_tokens": 100},
        system_prompt="S",
        rolling_system_prompt="R",
    ):
        events.append(event)
    return events


@pytest.mark.anyio
async def test_single_window_document_emits_tokens_then_done():
    pieces = [TokenPiece(id=i, piece=p) for i, p in enumerate(["uno", " dos"])]
    provider = _fake_provider(pieces, [["Res", "umen"]])

    events = await _collect(provider, _budget())

    assert [e.text for e in events if isinstance(e, TokenEvent)] == ["Res", "umen"]
    done = events[-1]
    assert isinstance(done, DoneEvent)
    assert done.summary == "Resumen"
    assert done.chunks_used == 1


@pytest.mark.anyio
async def test_document_larger_than_one_window_rolls_the_summary_forward(monkeypatch):
    # A budget this tight relative to the 20-piece document forces a rollover;
    # ctx=200/first=10/rolling=20/out=100 (as tried initially) leaves a
    # first-window budget of 90 tokens, which swallows all 20 pieces in one
    # window and never rolls over -- too generous to exercise this path.
    monkeypatch.setattr(settings, "LLM_CHUNK_OVERLAP_TOKENS", 0)
    pieces = [TokenPiece(id=i, piece=f" w{i}") for i in range(20)]
    provider = _fake_provider(pieces, [["A"], ["B"], ["C"], ["D"], ["E"]])

    events = await _collect(provider, _budget(ctx=35, first=5, rolling=5, out=20))

    done = events[-1]
    assert isinstance(done, DoneEvent)
    assert done.chunks_used > 1
    # Every window after the first carries the prior summary in its prompt.
    assert any("[RESUMEN PARCIAL]" in p for p in provider.sent_prompts[1:])


@pytest.mark.anyio
async def test_every_window_is_verified_against_the_effective_context():
    pieces = [TokenPiece(id=i, piece=f" w{i}") for i in range(20)]
    provider = _fake_provider(pieces, [["A"], ["B"], ["C"], ["D"], ["E"]])

    await _collect(provider, _budget(ctx=200, first=10, rolling=20, out=100))

    # One exact preflight per generated window.
    assert provider.acount_prompt_tokens.await_count >= len(provider.sent_prompts)


@pytest.mark.anyio
async def test_steps_are_emitted_per_window():
    pieces = [TokenPiece(id=i, piece=f" w{i}") for i in range(20)]
    provider = _fake_provider(pieces, [["A"], ["B"], ["C"], ["D"], ["E"]])

    events = await _collect(provider, _budget(ctx=200, first=10, rolling=20, out=100))

    steps = [e.step for e in events if isinstance(e, StepEvent)]
    assert [s.chunk_index for s in steps] == list(range(len(steps)))
    assert all(s.input_tokens > 0 for s in steps)


@pytest.mark.anyio
async def test_empty_text_produces_an_empty_summary_without_calling_the_model():
    provider = _fake_provider([], [])

    events = await _collect(provider, _budget(), pieces_text="   ")

    assert events == [DoneEvent(summary="", chunks_used=0)]
    assert provider.sent_prompts == []


@pytest.mark.anyio
async def test_empty_completion_from_exhausted_reasoning_raises():
    pieces = [TokenPiece(id=0, piece="uno")]
    provider = MagicMock()
    provider.atokenize_pieces = AsyncMock(return_value=pieces)
    provider.atokenize = AsyncMock(return_value=[])
    provider.acount_prompt_tokens = AsyncMock(return_value=1)

    async def _stream(prompt=None, **kwargs):
        yield LLMResponse(text="", metadata={"finish_reason": "length"})

    provider.async_stream = _stream

    with pytest.raises(EmptyCompletionError, match="max_tokens"):
        await _collect(provider, _budget())
