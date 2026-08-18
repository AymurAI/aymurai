from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

from aymurai.llm_providers.openai_compatible_provider import OpenAICompatibleLLMProvider
from aymurai.llm_providers.tokens import TokenPiece
from aymurai.logger import get_logger
from aymurai.settings import settings

logger = get_logger(__name__)

# Reserve for chat-template markup (turn/role markers, BOS) on top of raw
# message content — measured ~14 tokens for a 2-turn (system+user) exchange
# against a real llama-server; doubled for headroom across templates/turn
# counts. Only used for the upfront chunk-sizing estimate in
# `summarization_engine._build_provider` — the actual pre-generation check
# uses `count_prompt_tokens`'s exact, real-template accounting instead.
# TODO(Task 4): dies with `_build_provider` once `build_context_budget` lands.
TEMPLATE_OVERHEAD_TOKENS = 32

# `llama-server` serves whatever it was launched with and ignores the request's
# `model` field, but the OpenAI SDK requires a non-empty string. This stands in
# until `resolve_served_model()` supplies the real id.
UNRESOLVED_MODEL = "llamacpp"


@dataclass(frozen=True)
class ServedModel:
    """The model actually being served by a `llama-server` `/v1/models` endpoint."""

    id: str
    n_ctx: int | None = None
    n_ctx_train: int | None = None
    capabilities: tuple[str, ...] = field(default_factory=tuple)


class LlamaCppLLMProvider(OpenAICompatibleLLMProvider):
    """Provider for a `llama.cpp` (`llama-server`) OpenAI-compatible endpoint."""

    provider_name: str = "llamacpp"

    def __init__(
        self,
        model: str | None = None,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        **kwargs,
    ) -> None:
        """
        Initialize a llama.cpp provider, defaulting connection details from settings.

        Args:
            model (str | None): Model identifier. Defaults to
                `UNRESOLVED_MODEL`, since `llama-server` ignores the field and
                serves whatever it was launched with; call
                `resolve_served_model()`/`aresolve_served_model()` for the
                real id.
            base_url (str | None): Base URL override. Defaults to
                `settings.LLAMACPP_BASE_URL`.
            api_key (str | None): API key override. Defaults to
                `settings.LLAMACPP_API_KEY`.
            **kwargs: Forwarded to `OpenAICompatibleLLMProvider`
                (`system_prompt`, `tokenizer`, `max_context_tokens`,
                `chunk_overlap`).

        Raises:
            ValueError: If neither `base_url` nor `settings.LLAMACPP_BASE_URL`
                is set. Without this guard the OpenAI SDK silently falls back
                to the public `https://api.openai.com` endpoint, sending
                request bodies to a third party instead of failing loudly.
        """
        resolved_base_url = base_url or settings.LLAMACPP_BASE_URL
        if not resolved_base_url:
            raise ValueError(
                "LlamaCppLLMProvider requires a base URL. Set LLAMACPP_BASE_URL "
                "(e.g. http://llama-server:8080/v1) or pass base_url= explicitly."
            )

        super().__init__(
            model=model or UNRESOLVED_MODEL,
            base_url=resolved_base_url,
            api_key=api_key or settings.LLAMACPP_API_KEY,
            **kwargs,
        )
        self._raw_client: httpx.Client | None = None
        self._raw_async_client: httpx.AsyncClient | None = None
        self._served_model: ServedModel | None = None

    def close(self) -> None:
        """Release the cached OpenAI SDK client and the raw llama.cpp-endpoint client."""
        super().close()
        if self._raw_client is not None:
            self._raw_client.close()
            self._raw_client = None

    async def aclose(self) -> None:
        """Release the cached OpenAI SDK client and the raw llama.cpp-endpoint client."""
        await super().aclose()
        if self._raw_async_client is not None:
            await self._raw_async_client.aclose()
            self._raw_async_client = None

    def tokenize(self, text: str, *, add_special: bool = False) -> list[int]:
        """
        Tokenize text exactly, via the server's own tokenizer.

        Args:
            text (str): Text to tokenize.
            add_special (bool): Include special tokens (e.g. BOS). Use True
                only for an already-templated prompt.

        Returns:
            list[int]: Token ids.
        """
        response = self._get_raw_client().post(
            "/tokenize", json={"content": text, "add_special": add_special}
        )
        response.raise_for_status()
        return response.json()["tokens"]

    async def atokenize(self, text: str, *, add_special: bool = False) -> list[int]:
        """Async counterpart of `tokenize`."""
        response = await self._get_raw_async_client().post(
            "/tokenize", json={"content": text, "add_special": add_special}
        )
        response.raise_for_status()
        return response.json()["tokens"]

    def tokenize_pieces(self, text: str) -> list[TokenPiece]:
        """
        Tokenize text and return each token with the source text it covers.

        The pieces concatenate back to `text` exactly, which is what lets
        chunking slice on token boundaries without a detokenize round-trip.

        Args:
            text (str): Text to tokenize.

        Returns:
            list[TokenPiece]: One entry per token, in order.
        """
        response = self._get_raw_client().post(
            "/tokenize",
            json={"content": text, "add_special": False, "with_pieces": True},
        )
        response.raise_for_status()
        return [
            TokenPiece(id=t["id"], piece=t["piece"]) for t in response.json()["tokens"]
        ]

    async def atokenize_pieces(self, text: str) -> list[TokenPiece]:
        """Async counterpart of `tokenize_pieces`."""
        response = await self._get_raw_async_client().post(
            "/tokenize",
            json={"content": text, "add_special": False, "with_pieces": True},
        )
        response.raise_for_status()
        return [
            TokenPiece(id=t["id"], piece=t["piece"]) for t in response.json()["tokens"]
        ]

    def render_prompt(self, messages: list[dict[str, str]]) -> str:
        """
        Render messages through the server's real chat template.

        Sends no `chat_template_kwargs`, so this inherits exactly the same
        server configuration inference uses — the property that keeps
        preflight counts equal to `usage.prompt_tokens`.

        Args:
            messages (list[dict[str, str]]): Chat messages.

        Returns:
            str: The fully rendered prompt string.
        """
        response = self._get_raw_client().post(
            "/apply-template", json={"messages": messages}
        )
        response.raise_for_status()
        return response.json()["prompt"]

    async def arender_prompt(self, messages: list[dict[str, str]]) -> str:
        """Async counterpart of `render_prompt`."""
        response = await self._get_raw_async_client().post(
            "/apply-template", json={"messages": messages}
        )
        response.raise_for_status()
        return response.json()["prompt"]

    def count_prompt_tokens(
        self,
        *,
        prompt: str | None = None,
        messages: list[dict[str, str]] | None = None,
    ) -> int:
        """
        Exact prompt token count: render the real template, then tokenize it.

        Matches the `usage.prompt_tokens` a real completion reports. Failures
        propagate — there is no estimator to degrade to, and a silent
        approximation here would void the context guarantee.

        Args:
            prompt (str | None): Single prompt string.
            messages (list[dict[str, str]] | None): Pre-formatted messages.

        Returns:
            int: Exact prompt token count.
        """
        built = self._build_messages(prompt=prompt, messages=messages)
        return len(self.tokenize(self.render_prompt(built), add_special=True))

    async def acount_prompt_tokens(
        self,
        *,
        prompt: str | None = None,
        messages: list[dict[str, str]] | None = None,
    ) -> int:
        """Async counterpart of `count_prompt_tokens`."""
        built = self._build_messages(prompt=prompt, messages=messages)
        rendered = await self.arender_prompt(built)
        return len(await self.atokenize(rendered, add_special=True))

    def _server_root(self) -> str:
        """
        The `llama-server` root, with `base_url`'s path stripped.

        `/apply-template` and `/tokenize` are `llama-server`-specific
        extensions that live outside the OpenAI-compatible `/v1` namespace
        `base_url` points at.
        """
        assert self.base_url, (
            "LlamaCppLLMProvider always has a base_url (enforced in __init__)"
        )
        return str(httpx.URL(self.base_url).copy_with(path="/"))

    def _get_raw_client(self) -> httpx.Client:
        """Return the cached raw (non-OpenAI-SDK) client, creating it on first use."""
        if self._raw_client is None:
            self._raw_client = httpx.Client(base_url=self._server_root())
        return self._raw_client

    def _get_raw_async_client(self) -> httpx.AsyncClient:
        """Return the cached raw (non-OpenAI-SDK) async client, creating it on first use."""
        if self._raw_async_client is None:
            self._raw_async_client = httpx.AsyncClient(base_url=self._server_root())
        return self._raw_async_client

    def resolve_served_model(self) -> ServedModel:
        """
        Query `/v1/models` and return the model actually being served.

        `llama-server` ignores the `model` field on chat-completion requests
        and always serves whatever it was launched with — this reflects that
        reality instead of trusting the constructor's placeholder model name.

        Returns:
            ServedModel: The model actually loaded, its real context window
                (from `meta.n_ctx`, when the server reports it), and any
                `capabilities` the server advertises.
        """
        models = list(self._get_client().models.list())
        return self._build_served_model(models, capabilities=self._fetch_capabilities())

    async def aresolve_served_model(self) -> ServedModel:
        """Async counterpart of `resolve_served_model`, memoized per instance."""
        if self._served_model is None:
            page = await self._get_async_client().models.list()
            models = [model async for model in page]
            self._served_model = self._build_served_model(
                models, capabilities=await self._afetch_capabilities()
            )
        return self._served_model

    def _build_served_model(
        self, models: list[Any], *, capabilities: tuple[str, ...]
    ) -> ServedModel:
        """
        Build a `ServedModel` from an SDK `models.list()` result.

        Args:
            models (list[Any]): Parsed OpenAI `Model` objects from
                `/v1/models`'s `data` array.
            capabilities (tuple[str, ...]): Capabilities already fetched via
                `_fetch_capabilities`/`_afetch_capabilities`.

        Returns:
            ServedModel: The first reported model, warning if more than one
                came back — `llama-server` normally serves exactly one.
        """
        if not models:
            raise RuntimeError(f"{self.base_url} reported no served models")

        served = models[0]
        if len(models) > 1:
            logger.warning(
                f"{self.base_url} reports {len(models)} models; llama-server "
                f"normally serves exactly one — using the first: {served.id!r}"
            )

        meta = (served.model_extra or {}).get("meta") or {}
        return ServedModel(
            id=served.id,
            n_ctx=meta.get("n_ctx"),
            n_ctx_train=meta.get("n_ctx_train"),
            capabilities=capabilities,
        )

    def _fetch_capabilities(self) -> tuple[str, ...]:
        """Best-effort sync read of `/v1/models`' `capabilities` field. See `_capabilities_from_raw`."""
        try:
            raw = self._get_client().get("/models", cast_to=object)
        except Exception:
            logger.debug(
                f"{self.base_url}: could not fetch capabilities", exc_info=True
            )
            return ()
        return self._capabilities_from_raw(raw)

    async def _afetch_capabilities(self) -> tuple[str, ...]:
        """Async counterpart of `_fetch_capabilities`."""
        try:
            raw = await self._get_async_client().get("/models", cast_to=object)
        except Exception:
            logger.debug(
                f"{self.base_url}: could not fetch capabilities", exc_info=True
            )
            return ()
        return self._capabilities_from_raw(raw)

    @staticmethod
    def _capabilities_from_raw(raw: Any) -> tuple[str, ...]:
        """
        Extract `capabilities` from a raw `/v1/models` payload.

        Some `llama-server` builds add a `models` array (outside the standard
        OpenAI `data` schema, so the SDK's typed `Model` object never surfaces
        it) with a `capabilities` field per entry.

        Args:
            raw (Any): The raw JSON payload from `GET /models`.

        Returns:
            tuple[str, ...]: The reported capabilities, or an empty tuple if
                the server doesn't include this field.
        """
        entries = (raw or {}).get("models") or []
        if not entries:
            return ()
        return tuple(entries[0].get("capabilities") or ())


__all__ = ["UNRESOLVED_MODEL", "LlamaCppLLMProvider", "ServedModel"]
