import hashlib
import json
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError, ValidationInfo, model_validator

from aymurai.api.endpoints.routers.llm.summarization_engine import ContextTooSmallError
from aymurai.llm_providers import LlamaCppLLMProvider
from aymurai.logger import get_logger
from aymurai.settings import settings
from aymurai.utils.yaml_data import load_yaml

logger = get_logger(__name__)

PROMPT_PATH = Path(settings.RESOURCES_BASEPATH) / "llm" / "data_extraction.yml"


class RawRecipient(BaseModel):
    name: str | None = None
    position: str | None = None
    is_primary: bool
    macro_sector: str | None = None


class RawExtraction(BaseModel):
    """The extraction shape as returned by the model, keys already in English."""

    recommendation_number: str | None = None
    recommendation_date: str | None = None
    recipients: list[RawRecipient] = Field(default_factory=list)
    topic: str | None = None
    subtopic: str | None = None
    personal_data: bool | None = None
    publishable_content: str

    @model_validator(mode="after")
    def _validate_topic_subtopic(self, info: ValidationInfo) -> "RawExtraction":
        topics: dict[str, list[str]] | None = (info.context or {}).get("topics")
        if topics is None:
            return self

        if self.topic is not None and self.topic not in topics:
            raise ValueError(f"'topic' {self.topic!r} no está en la taxonomía vigente")

        if self.subtopic is None:
            return self
        if self.topic is None:
            raise ValueError("No se puede especificar 'subtopic' sin 'topic'")

        valid = topics.get(self.topic, [])
        if self.subtopic not in valid:
            raise ValueError(
                f"'subtopic' {self.subtopic!r} no pertenece a 'topic' {self.topic!r}. "
                f"Válidos: {sorted(valid)}"
            )
        return self


def _nullable_string() -> dict:
    return {"anyOf": [{"type": "string"}, {"type": "null"}]}


def _nullable_enum(values: list) -> dict:
    return {"enum": [*values, None]}


def build_response_schema(
    topic_names: list[str], macro_sector_names: list[str]
) -> dict:
    """
    Builds the `response_format` JSON Schema for a data-extraction request.

    Every nullable field uses either a flat `enum` including `null`, or
    `anyOf` with a separate `null` branch -- never `type: [..., "null"]`
    combined with `enum`, which llama.cpp's GBNF converter silently ignores.

    Args:
        topic_names (list[str]): Active topic names, used as the `topic` enum.
        macro_sector_names (list[str]): Active macro sector names, used as
            the `macro_sector` enum.

    Returns:
        dict: The JSON Schema, ready to embed in `response_format`.
    """
    recipient_schema = {
        "type": "object",
        "properties": {
            "name": _nullable_string(),
            "position": _nullable_string(),
            "is_primary": {"type": "boolean"},
            "macro_sector": _nullable_enum(macro_sector_names),
        },
        "required": ["name", "position", "is_primary", "macro_sector"],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {
            "recommendation_number": _nullable_string(),
            "recommendation_date": _nullable_string(),
            "recipients": {"type": "array", "items": recipient_schema},
            "topic": _nullable_enum(topic_names),
            "subtopic": _nullable_string(),
            "personal_data": _nullable_enum([True, False]),
            "publishable_content": {"type": "string"},
        },
        "required": [
            "recommendation_number",
            "recommendation_date",
            "recipients",
            "topic",
            "subtopic",
            "personal_data",
            "publishable_content",
        ],
        "additionalProperties": False,
    }


def _build_fields_block(fields: dict[str, str]) -> str:
    return "\n".join(f"- **{name}**: {desc.strip()}" for name, desc in fields.items())


def _build_taxonomy_block(topics: dict[str, list[str]]) -> str:
    lines = []
    for topic_name, subtopic_names in topics.items():
        lines.append(f"- {topic_name}")
        lines.extend(f"  - {sub}" for sub in subtopic_names)
    return "\n".join(lines)


def build_system_prompt(
    topics: dict[str, list[str]], macro_sector_names: list[str]
) -> str:
    """
    Builds the static+dynamic system prompt: persona/guidelines/field
    descriptions from `data_extraction.yml`, plus the current topic/subtopic
    taxonomy and macro sectors read from the catalogs.

    Never uses `.format()` on the assembled result -- it embeds a JSON
    example full of braces, which would break a later `.format()` call.

    Args:
        topics (dict[str, list[str]]): Active topic name -> its active
            subtopic names.
        macro_sector_names (list[str]): Active macro sector names.

    Returns:
        str: The full system prompt.
    """
    config = load_yaml(str(PROMPT_PATH))
    prompts = config["system-prompts"]
    example_json = json.dumps(config["output-example"], ensure_ascii=False, indent=2)

    return (
        f"{prompts['persona']}\n\n"
        f"{prompts['guidelines']}\n"
        "# Campos a extraer\n\n"
        f"{_build_fields_block(config['fields'])}\n\n"
        "# Sectores macro disponibles\n\n"
        f"{', '.join(macro_sector_names)}\n\n"
        "# Temas y subtemas disponibles\n\n"
        f"{_build_taxonomy_block(topics)}\n\n"
        "# Formato de salida (JSON)\n\n"
        "Respondé exclusivamente con un objeto JSON con esta estructura:\n\n"
        f"```json\n{example_json}\n```\n"
    )


def build_correction_prompt(
    base_system_prompt: str, error: str, previous_output: str
) -> str:
    """
    Builds a one-shot correction prompt from the ORIGINAL system prompt plus
    only the latest error/output -- never from a previous correction, so
    retries don't nest.

    Args:
        base_system_prompt (str): The unmodified original system prompt.
        error (str): Validation error from the latest attempt.
        previous_output (str): The latest attempt's raw JSON output.

    Returns:
        str: The correction system prompt for the next attempt.
    """
    return (
        f"{base_system_prompt}\n\n"
        "# Corrección obligatoria\n\n"
        "Tu respuesta anterior no pasó la validación automática. Devolvé "
        "exclusivamente un objeto JSON válido con la misma estructura.\n\n"
        f"Error de validación:\n{error}\n\n"
        f"Respuesta anterior:\n{previous_output}\n"
    )


async def preflight(
    provider: LlamaCppLLMProvider,
    *,
    system_prompt: str,
    document_text: str,
    max_tokens: int,
) -> None:
    """
    Checks the full prompt (system + whole document, no chunking) fits the
    server's context window with room for `max_tokens` of output.

    Args:
        provider (LlamaCppLLMProvider): Provider to measure tokens against.
        system_prompt (str): The composed system prompt.
        document_text (str): The full document text.
        max_tokens (int): Reserved output budget.

    Raises:
        ContextTooSmallError: If the document doesn't fit.
    """
    served = await provider.aresolve_served_model()
    server_ctx = served.n_ctx or served.n_ctx_train
    if not server_ctx:
        raise ContextTooSmallError("LLM server did not report a context window")

    effective_ctx = (
        min(server_ctx, settings.LLM_MAX_CONTEXT_TOKENS)
        if settings.LLM_MAX_CONTEXT_TOKENS
        else server_ctx
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": document_text},
    ]
    prompt_tokens = await provider.acount_prompt_tokens(messages=messages)
    if prompt_tokens + max_tokens > effective_ctx:
        raise ContextTooSmallError(
            f"document ({prompt_tokens} prompt tokens) + max_tokens "
            f"({max_tokens}) leaves no room in the {effective_ctx}-token "
            "context window"
        )


def catalogs_hash(topics: dict[str, list[str]], macro_sector_names: list[str]) -> str:
    """
    Deterministic hash of the topic/subtopic/macro-sector snapshot a prompt
    was built from, for traceability when catalogs later change.

    Args:
        topics (dict[str, list[str]]): Active topic name -> subtopic names.
        macro_sector_names (list[str]): Active macro sector names.

    Returns:
        str: Hex sha256 digest of a canonical dump of both.
    """
    canonical = json.dumps(
        {
            "topics": {name: sorted(subs) for name, subs in topics.items()},
            "macro_sectors": sorted(macro_sector_names),
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def extract_with_retry(
    provider: LlamaCppLLMProvider,
    *,
    document_text: str,
    base_system_prompt: str,
    schema: dict,
    topics: dict[str, list[str]],
    max_retries: int,
    max_tokens: int,
    extra_options: dict | None = None,
) -> tuple[RawExtraction, int]:
    """
    Calls the LLM with structured output and validates the topic/subtopic
    pair, retrying on failure. Each retry is built from the original prompt
    plus only the latest error -- never from a previous retry's correction,
    so the prompt sent never grows across attempts.

    Exhausted retries never fail the request: `topic`/`subtopic` are set to
    `null` and the rest of the extraction is kept as-is.

    Args:
        provider (LlamaCppLLMProvider): Provider to call.
        document_text (str): Full document text (single-shot, no chunking).
        base_system_prompt (str): The unmodified original system prompt.
        schema (dict): The `response_format` JSON Schema.
        topics (dict[str, list[str]]): Active topic name -> subtopic names,
            used to validate the pair the model returned.
        max_retries (int): Retries after the first attempt.
        max_tokens (int): Output token budget per attempt.
        extra_options (dict | None): Extra OpenAI-native generation kwargs
            (e.g. `temperature`, `seed`), merged in but never allowed to
            override `response_format`/`max_tokens`.

    Returns:
        tuple[RawExtraction, int]: The validated extraction, and how many
            attempts it took (0 = first try).
    """
    last_error: str | None = None
    last_parsed: dict | None = None

    for attempt in range(max_retries + 1):
        system_prompt = (
            base_system_prompt
            if attempt == 0
            else build_correction_prompt(
                base_system_prompt, last_error or "", json.dumps(last_parsed)
            )
        )
        response = await provider.async_generate(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": document_text},
            ],
            **{
                **(extra_options or {}),
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "data_extraction",
                        "strict": True,
                        "schema": schema,
                    },
                },
                "max_tokens": max_tokens,
                "extra_body": {"reasoning_effort": "none"},
            },
        )

        try:
            last_parsed = json.loads(response.text)
            return RawExtraction.model_validate(
                last_parsed, context={"topics": topics}
            ), attempt
        except (json.JSONDecodeError, ValidationError) as exc:
            last_error = str(exc)
            logger.warning(
                "data-extraction validation failed (attempt %d): %s", attempt + 1, exc
            )

    # ADR-0005: an invalid payload after every retry degrades to null fields,
    # never a 5xx. Try the cheapest repair first -- nulling the semantic pair
    # that the retry loop exists to police -- and if the payload is broken in
    # some other way, fall back to the empty skeleton rather than propagating
    # a ValidationError to the caller.
    skeleton = {
        "recommendation_number": None,
        "recommendation_date": None,
        "recipients": [],
        "personal_data": None,
        "publishable_content": "",
        "topic": None,
        "subtopic": None,
    }

    # `isinstance`, not `is not None`: `json.loads` succeeds on "null",
    # "[1,2]" and "42", none of which survive `{**...}` -- that raises
    # TypeError, which the `except ValidationError` below would NOT catch,
    # and the 500 this fallback exists to prevent would come straight back.
    if isinstance(last_parsed, dict):
        repaired = {**last_parsed, "topic": None, "subtopic": None}
        try:
            return RawExtraction.model_validate(
                repaired, context={"topics": topics}
            ), max_retries
        except ValidationError as exc:
            logger.warning(
                "data-extraction fallback could not repair the last parse, "
                "degrading to empty extraction: %s",
                exc,
            )

    return RawExtraction.model_validate(
        skeleton, context={"topics": topics}
    ), max_retries
