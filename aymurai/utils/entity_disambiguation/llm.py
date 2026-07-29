import copy
import json
from functools import lru_cache
from pathlib import Path

from more_itertools import unique_everseen
from transformers import AutoTokenizer

from aymurai.llm_providers import OllamaLLMProvider
from aymurai.meta.api_interfaces import (
    DocLabel,
    DocumentAnnotations,
    PromptLibrary,
    PromptSet,
)
from aymurai.meta.entities import CanonicalEntities, CanonicalEntity
from aymurai.settings import settings
from aymurai.utils.json_data import get_pretty
from aymurai.utils.yaml_data import load_yaml


@lru_cache(maxsize=1)
def load_prompts_from_yaml():
    path = Path(settings.RESOURCES_BASEPATH) / "llm/entity_disambiguation.yml"
    data = load_yaml(file_path=str(path))

    prompts = []
    for label, content in data.items():
        prompts.append(
            PromptSet(
                label=label,
                system=content.get("system", ""),
                user=content.get("user", ""),
            )
        )
    return PromptLibrary(root=prompts)


def _extract_snippet(doc_text: str, label: DocLabel, window_length: int | None) -> str:
    if window_length is None:
        return " ".join(doc_text.split())

    start, end = label.start_char, label.end_char
    window_start = max(0, start - window_length)
    window_end = min(len(doc_text), end + window_length)

    while window_start > 0 and not doc_text[window_start - 1].isspace():
        window_start -= 1
    while window_end < len(doc_text) and not doc_text[window_end - 1].isspace():
        window_end += 1

    snippet = doc_text[window_start:window_end]
    return " ".join(snippet.split())


def _iter_alias_snippets(
    predictions: DocumentAnnotations,
    *,
    entity_label: str,
    aliases_set: set[str],
    window_length: int | None,
):
    for pred in predictions:
        if not pred.labels:
            continue
        doc_text = getattr(pred, "document", "")

        for label in pred.labels:
            if label.attrs.aymurai_label != entity_label:
                continue

            alias = label.attrs.aymurai_alt_text or label.text
            if alias not in aliases_set:
                continue

            snippet = _extract_snippet(doc_text, label, window_length)
            yield alias, snippet


def _collect_entity_context(
    predictions: DocumentAnnotations,
    entity_label: str,
    aliases: list[str],
    window_length: int | None,
    max_context_snippets: int | None = 5,
) -> list[str]:
    aliases_set = set(aliases)

    deduped_in_order = list(
        unique_everseen(
            _iter_alias_snippets(
                predictions,
                entity_label=entity_label,
                aliases_set=aliases_set,
                window_length=window_length,
            ),
            key=lambda item: item[1],
        )
    )

    seen_aliases: set[str] = set()
    baseline = [
        snippet
        for alias, snippet in deduped_in_order
        if not (alias in seen_aliases or seen_aliases.add(alias))
    ]

    baseline_set = set(baseline)
    remaining = [
        snippet for _, snippet in deduped_in_order if snippet not in baseline_set
    ]

    merged = baseline + remaining

    effective_limit = (
        None
        if max_context_snippets is None
        else max(max_context_snippets, len(baseline))
    )

    return merged if effective_limit is None else merged[:effective_limit]


def _add_canonical_entities_context(
    predictions: DocumentAnnotations,
    entities: CanonicalEntities,
    context_window_length: int | None = 120,
    target_label: str | None = None,
    max_snippets_per_entity: int | None = 5,
) -> CanonicalEntities:
    entities_with_context = copy.deepcopy(entities)

    for entity in entities_with_context:
        if entity.attributes is None:
            entity.attributes = {}

        current_target = target_label or entity.aymurai_label

        entity.attributes["context"] = _collect_entity_context(
            predictions,
            current_target,
            list(entity.aliases),
            context_window_length,
            max_snippets_per_entity,
        )

    return entities_with_context


_TOKENIZER_CACHE = {}


def _get_model_tokens(
    system_prompt: str, user_prompt: str, tokenizer_model: str
) -> int:
    try:
        if tokenizer_model not in _TOKENIZER_CACHE:
            _TOKENIZER_CACHE[tokenizer_model] = AutoTokenizer.from_pretrained(
                tokenizer_model
            )

        tokenizer = _TOKENIZER_CACHE[tokenizer_model]

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        full_text = tokenizer.apply_chat_template(messages, tokenize=False)
        tokens = tokenizer.encode(full_text)

        return len(tokens)

    except Exception:
        combined_text = f"{system_prompt} {user_prompt}"
        word_count = len(combined_text.split())
        approx_tokens = int(word_count * 1.4) + 20
        return approx_tokens


def llm_canonical_entities_inference(
    paragraphs: DocumentAnnotations,
    canonical_entities_pre_cluster: CanonicalEntities,
    system_prompt: str,
    user_prompt_template: str,
    model: str,
    tokenizer_model: str,
    target_label: str,
    context_window_length: int | None = 120,
    model_context: int = 9_500,
    token_limit_frac: float = 2 / 3,
    temperature: int = 0,
    decompose_by: int | None = 0,
) -> CanonicalEntities:
    canonical_entities_with_context = _add_canonical_entities_context(
        predictions=paragraphs,
        entities=canonical_entities_pre_cluster,
        context_window_length=context_window_length,
        target_label=target_label,
    )

    canonical_entities_prompt = [
        ce.model_dump(include={"canonical_text", "aliases", "attributes"})
        for ce in canonical_entities_with_context
    ]

    token_limit = int(model_context * token_limit_frac)

    if decompose_by is None:
        current_batch_size = len(canonical_entities_prompt)

        while current_batch_size > 0:
            test_batch = canonical_entities_prompt[:current_batch_size]
            test_prompt = user_prompt_template.format(
                canonical_entities=get_pretty(test_batch)
            )

            num_tokens = _get_model_tokens(
                system_prompt=system_prompt,
                user_prompt=test_prompt,
                tokenizer_model=tokenizer_model,
            )

            if num_tokens <= token_limit:
                decompose_by = current_batch_size
                break

            current_batch_size -= 1

        if not decompose_by:
            return None

    if decompose_by <= 0:
        entity_batches = [canonical_entities_prompt]
    else:
        entity_batches = [
            canonical_entities_prompt[i : i + decompose_by]
            for i in range(0, len(canonical_entities_prompt), decompose_by)
        ]

    all_raw_outputs = []

    for batch in entity_batches:
        user_prompt = user_prompt_template.format(
            canonical_entities=get_pretty(batch),
        )

        len_tokens = _get_model_tokens(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            tokenizer_model=tokenizer_model,
        )
        if len_tokens > model_context:
            continue

        provider = OllamaLLMProvider(model=model)
        response = provider.generate(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            options={"temperature": temperature, "num_ctx": model_context},
            format=CanonicalEntities.model_json_schema(),
        )

        batch_entities = json.loads(response.text).get("canonical_entities", [])
        all_raw_outputs.extend(batch_entities)

    canonical_entities_llm = [
        CanonicalEntity.model_validate(e) for e in all_raw_outputs
    ]

    return canonical_entities_llm
