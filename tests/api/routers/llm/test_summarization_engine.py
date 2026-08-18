from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from aymurai.api.endpoints.routers.llm import summarization_engine as engine
from aymurai.api.endpoints.routers.llm.summarization_engine import (
    ContextBudget,
    ContextTooSmallError,
    build_context_budget,
)
from aymurai.llm_providers import LLMProvider, LLMResponse
from aymurai.llm_providers.llamacpp_provider import (
    TEMPLATE_OVERHEAD_TOKENS,
    ServedModel,
)
from aymurai.settings import settings

LLAMACPP_MODULE = "aymurai.llm_providers.llamacpp_provider"


class _FakeLLMProvider(LLMProvider):
    """In-memory LLMProvider stub for exercising the engine without a real backend."""

    def __init__(
        self, *, max_context_tokens=None, responses=None, exact_prompt_tokens=None
    ):
        super().__init__(model="fake", max_context_tokens=max_context_tokens)
        self.generate_calls: list[str] = []
        self._responses = list(responses or [])
        self._exact_prompt_tokens = exact_prompt_tokens

    def generate(self, prompt, **kwargs):
        raise NotImplementedError

    def stream(self, prompt, **kwargs):
        raise NotImplementedError

    async def async_generate(self, prompt, **kwargs):
        self.generate_calls.append(prompt)
        text = (
            self._responses.pop(0)
            if self._responses
            else f"summary::{len(self.generate_calls)}"
        )
        return LLMResponse(text=text)

    async def async_stream(self, prompt, **kwargs):
        async for item in super().async_stream(prompt, **kwargs):
            yield item  # pragma: no cover -- base implementation always raises first

    async def acount_prompt_tokens(self, *, prompt=None, messages=None):
        if self._exact_prompt_tokens is not None:
            return self._exact_prompt_tokens
        return await super().acount_prompt_tokens(prompt=prompt, messages=messages)


@pytest.mark.anyio
async def test_build_provider_caps_context_limit_to_server_n_ctx(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "llamacpp")
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    served = ServedModel(id="model", n_ctx=2_000, n_ctx_train=131_072)
    with patch(
        f"{LLAMACPP_MODULE}.LlamaCppLLMProvider.aresolve_served_model",
        new=AsyncMock(return_value=served),
    ):
        provider, effective_ctx = await engine._build_provider(
            None,
            tokenizer_name=None,
            system_prompt="Sistema",
            context_limit=8_000,
            options={"num_predict": 100},
        )

    assert (
        effective_ctx == 2_000
    )  # capped by the server's real n_ctx, not the requested 8_000
    expected_budget = 2_000 - 100 - len("Sistema".split()) - TEMPLATE_OVERHEAD_TOKENS
    assert provider.max_context_tokens == expected_budget


@pytest.mark.anyio
async def test_build_provider_falls_back_to_n_ctx_train_when_n_ctx_absent(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "llamacpp")
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    served = ServedModel(id="model", n_ctx=None, n_ctx_train=4_000)
    with patch(
        f"{LLAMACPP_MODULE}.LlamaCppLLMProvider.aresolve_served_model",
        new=AsyncMock(return_value=served),
    ):
        _, effective_ctx = await engine._build_provider(
            None,
            tokenizer_name=None,
            system_prompt="Sistema",
            context_limit=8_000,
            options={"num_predict": 100},
        )

    assert effective_ctx == 4_000


@pytest.mark.anyio
async def test_build_provider_does_not_cap_when_requested_is_already_smaller(
    monkeypatch,
):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "llamacpp")
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    served = ServedModel(id="model", n_ctx=131_072)
    with patch(
        f"{LLAMACPP_MODULE}.LlamaCppLLMProvider.aresolve_served_model",
        new=AsyncMock(return_value=served),
    ):
        _, effective_ctx = await engine._build_provider(
            None,
            tokenizer_name=None,
            system_prompt="Sistema",
            context_limit=4_096,
            options={"num_predict": 100},
        )

    assert effective_ctx == 4_096


@pytest.mark.anyio
async def test_build_provider_max_context_tokens_never_goes_below_one(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "llamacpp")
    monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://llamacpp:8080/v1")

    served = ServedModel(id="model", n_ctx=50)
    with patch(
        f"{LLAMACPP_MODULE}.LlamaCppLLMProvider.aresolve_served_model",
        new=AsyncMock(return_value=served),
    ):
        provider, _ = await engine._build_provider(
            None,
            tokenizer_name=None,
            system_prompt="A very long system prompt with plenty of words in it",
            context_limit=50,
            options={"num_predict": 100},  # already exceeds the whole ceiling
        )

    assert provider.max_context_tokens == 1


@pytest.mark.anyio
async def test_build_provider_ollama_has_no_effective_ctx_and_no_template_margin(
    monkeypatch,
):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "ollama")

    provider, effective_ctx = await engine._build_provider(
        None,
        tokenizer_name=None,
        system_prompt="Sistema",
        context_limit=4_096,
        options={"num_predict": 100},
    )

    assert effective_ctx is None
    assert provider.max_context_tokens == 4_096 - 100 - len("Sistema".split())


@pytest.mark.anyio
async def test_ensure_within_context_returns_text_unchanged_when_it_fits():
    provider = _FakeLLMProvider(max_context_tokens=1_000, exact_prompt_tokens=50)

    result = await engine._ensure_within_context(
        provider, "some prompt text", options={"num_predict": 100}, effective_ctx=1_000
    )

    assert result == "some prompt text"


@pytest.mark.anyio
async def test_ensure_within_context_is_a_noop_when_effective_ctx_is_none():
    provider = _FakeLLMProvider(max_context_tokens=10, exact_prompt_tokens=999_999)

    result = await engine._ensure_within_context(
        provider, "some prompt text", options={"num_predict": 100}, effective_ctx=None
    )

    # No server-fixed ceiling to check against (Ollama) -> no trimming attempted,
    # regardless of how large the (irrelevant) exact count would be.
    assert result == "some prompt text"


@pytest.mark.anyio
async def test_ensure_within_context_trims_when_prompt_plus_output_exceeds_ceiling(
    caplog,
):
    provider = _FakeLLMProvider(max_context_tokens=2, exact_prompt_tokens=900)

    result = await engine._ensure_within_context(
        provider,
        "uno dos tres cuatro cinco seis siete ocho nueve diez",
        options={"num_predict": 200},
        effective_ctx=1_000,  # 900 + 200 > 1000 -> must trim
    )

    assert (
        len(result.split()) <= 2
    )  # trimmed to provider.max_context_tokens via _trim_to_context
    assert "exceeds the effective context" in caplog.text


@pytest.mark.anyio
async def test_ensure_within_context_never_exceeds_the_ceiling_end_to_end():
    """No prompt this helper returns should, combined with num_predict, exceed effective_ctx."""
    provider = _FakeLLMProvider(max_context_tokens=3, exact_prompt_tokens=5_000)
    num_predict = 100
    effective_ctx = 200

    result = await engine._ensure_within_context(
        provider,
        "palabra " * 50,
        options={"num_predict": num_predict},
        effective_ctx=effective_ctx,
    )

    # The trimmed result respects the chunk-sizing budget, which was itself
    # derived (in _build_provider) to leave room for num_predict.
    assert provider.count_tokens(result) <= provider.max_context_tokens


@pytest.mark.anyio
async def test_rolling_summarize_chunks_a_document_larger_than_one_context_window():
    provider = _FakeLLMProvider(max_context_tokens=5)
    long_text = " ".join(f"palabra{i}" for i in range(50))

    summary, steps, chunk_count = await engine._rolling_summarize(
        provider, text=long_text, options={"num_predict": 10}
    )

    assert chunk_count > 1
    assert len(steps) >= chunk_count
    assert provider.generate_calls  # the fake provider was actually invoked
    assert summary  # rolling summarization produced a final result


@pytest.mark.anyio
async def test_rolling_summarize_single_chunk_short_document():
    provider = _FakeLLMProvider(max_context_tokens=1_000, responses=["Resumen corto."])

    summary, steps, chunk_count = await engine._rolling_summarize(
        provider, text="Texto corto de una sola oracion.", options={"num_predict": 10}
    )

    assert chunk_count == 1
    assert len(steps) == 1
    assert summary == "Resumen corto."


@pytest.mark.anyio
async def test_rolling_summarize_empty_text_returns_no_chunks():
    provider = _FakeLLMProvider(max_context_tokens=1_000)

    summary, steps, chunk_count = await engine._rolling_summarize(
        provider, text="   ", options={"num_predict": 10}
    )

    assert (summary, steps, chunk_count) == ("", [], 0)
    assert provider.generate_calls == []


@pytest.mark.anyio
async def test_rolling_summarize_forwards_effective_ctx_to_the_safety_check():
    """A provider whose exact count always overflows must never receive an
    un-trimmed prompt, even though chunk_text's own estimate says it fits."""
    provider = _FakeLLMProvider(max_context_tokens=5, exact_prompt_tokens=1_000)
    long_text = " ".join(f"palabra{i}" for i in range(30))

    await engine._rolling_summarize(
        provider,
        text=long_text,
        options={"num_predict": 10},
        effective_ctx=50,  # 1_000 (exact) + 10 > 50 on every call -> always trimmed
    )

    assert provider.generate_calls
    for prompt in provider.generate_calls:
        assert provider.count_tokens(prompt) <= provider.max_context_tokens


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
