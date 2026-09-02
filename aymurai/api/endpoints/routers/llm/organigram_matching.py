import re
import uuid
from functools import lru_cache
from typing import Literal

import numpy as np
from pydantic import BaseModel
from rapidfuzz import fuzz, process
from sqlmodel import Session, select

from aymurai.database.crud.organigram.sector import resolve_sector
from aymurai.database.crud.organigram.unit import ancestor_chain, ruta_organigrama
from aymurai.database.crud.recipient import recipient_learned_index_lookup
from aymurai.database.schema import MacroSector, OrganigramHolder, OrganigramUnit
from aymurai.logger import get_logger
from aymurai.models.sentence_encoder.factory import create_encoder
from aymurai.settings import settings
from aymurai.text.matching import normalize_text
from aymurai.utils.cache import cache_load, cache_save, get_cache_key

logger = get_logger(__name__)

SearchBackend = Literal["fuzzy", "embeddings", "hybrid"]
EMBEDDING_ENCODER_NAME = "minilm"

# Role titles after which the following words name the actual cargo, e.g.
# "Secretario de Deportes del Ministerio de ..." -> the role is "Secretario de
# Deportes"; everything from "del Ministerio ..." on is the parent chain. The
# "de" right after the role is optional: some cargos read "Directora General
# Obras en Vías Peatonales" with no "de" before the topic.
CARGO_ROLE_PREFIXES = (
    "ministro",
    "ministra",
    # "General" here is part of the title ("Secretary General"), not the
    # start of the topic clause -- these must come before the bare
    # "secretario"/"secretaria" below, or the alternation matches the
    # shorter prefix first and "general" gets mistaken for the topic (regex
    # `|` alternation picks the first matching branch, not the longest).
    "secretario general",
    "secretaria general",
    "secretario",
    "secretaria",
    "subsecretario",
    "subsecretaria",
    "director general",
    "directora general",
    "director",
    "directora",
    "presidente",
    "presidenta",
    "titular",
    "jefe",
    "jefa",
    "interventor",
    "interventora",
    "coordinador",
    "coordinadora",
)
CARGO_ROLE_PATTERN = re.compile(
    r"^(" + "|".join(CARGO_ROLE_PREFIXES) + r")\b(?:\s+(?:de\s+)?)?"
)

# del/de la/de only counts as the parent-chain boundary when followed by an
# actual parent-institution noun -- otherwise "del"/"de la" inside a compound
# office name (e.g. "Registro del Estado Civil") gets mistaken for it.
PARENT_INSTITUTION_KEYWORDS = (
    "ministerio",
    "secretaria",
    "subsecretaria",
    "gobierno",
    "jefatura",
    "agencia",
    "ente",
    "sindicatura",
    "procuracion",
)
CARGO_PARENT_MARKERS = re.compile(
    r"\s*,?\s+(?:dependiente\s+)?(?:del|de la|de)\s+"
    r"(?=(?:" + "|".join(PARENT_INSTITUTION_KEYWORDS) + r")\b)"
)

# Boilerplate that shows up in almost every extracted position but never in
# the organigram's own `name` values, so it only adds noise to the match.
CARGO_NOISE_PATTERNS = [
    r"\bgobierno de la ciudad autonoma de buenos aires\b",
    r"\bgobierno de la ciudad de buenos aires\b",
    r"\bciudad autonoma de buenos aires\b",
    r"\bciudad de buenos aires\b",
]


def _extract_cargo_role(text: str) -> str:
    """
    Keep only the "<role> de <topic>" clause, dropping the "del/dependiente
    de/de la ..." parent-institution chain that follows a role title.

    Args:
        text (str): Already-normalized cargo text.

    Returns:
        str: Text with the parent-institution chain removed, if a role prefix was found.
    """
    match = CARGO_ROLE_PATTERN.match(text)
    if not match:
        return text
    rest = text[match.end() :]
    parent_match = CARGO_PARENT_MARKERS.search(rest)
    topic = (rest[: parent_match.start()] if parent_match else rest).strip()
    if not topic:
        return match.group(1).strip()
    first_word = topic.split(" ", 1)[0]
    if first_word not in ("de", "del", "dependiente"):
        topic = f"de {topic}"
    return f"{match.group(1)} {topic}".strip()


def _strip_noise_and_trailing(text: str) -> str:
    """
    Remove GCBA boilerplate phrases and any dangling trailing preposition.

    Args:
        text (str): Already-normalized cargo text.

    Returns:
        str: Cleaned text.
    """
    for pattern in CARGO_NOISE_PATTERNS:
        text = re.sub(pattern, " ", text)
    text = re.sub(
        r"\b(del|de la|de|dependiente(?: del| de la| de)?)\s*$", "", text.strip()
    )
    return re.sub(r"\s+", " ", text).strip()


def clean_cargo(value: str | None) -> str:
    """
    Normalize, extract the role-prefix clause, and strip GCBA boilerplate.

    Args:
        value (str | None): Raw cargo text.

    Returns:
        str: Cleaned cargo text, ready for matching.
    """
    return _strip_noise_and_trailing(_extract_cargo_role(normalize_text(value)))


class OrganigramCandidate(BaseModel):
    """One ranked alternative for a recipient's `organigram_unit`."""

    unit_id: uuid.UUID
    unit_name: str
    sector_name: str | None = None
    ruta_organigrama: str
    score: float


class RecipientMatch(BaseModel):
    unit_id: uuid.UUID | None = None
    unit_name: str | None = None
    sector_id: uuid.UUID | None = None
    sector_name: str | None = None
    method: Literal["cargo", "name"] | None = None
    # Top-`DATA_EXTRACTION_TOP_K` cargo matches, best first, regardless of
    # whether the top one cleared the auto-resolve threshold -- lets a human
    # pick a different one in `validate` when the auto-resolved unit (or the
    # lack of one) is wrong.
    sector_candidates: list[OrganigramCandidate] = []


@lru_cache(maxsize=1)
def _get_encoder():
    return create_encoder(encoder_type=EMBEDDING_ENCODER_NAME)


def _l2_normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=-1, keepdims=True)
    return vectors / np.clip(norms, 1e-9, None)


def _unit_corpus(session: Session) -> list[OrganigramUnit]:
    # `ORDER BY id` is load-bearing, not cosmetic: the embeddings cache stores
    # vectors positionally aligned to this corpus (see `_rows_cache_context`).
    return list(
        session.exec(
            select(OrganigramUnit)
            .where(OrganigramUnit.active)
            .order_by(OrganigramUnit.id)
        ).all()
    )


def _holder_corpus(session: Session, *, current_only: bool) -> list[OrganigramHolder]:
    # `ORDER BY id` for the same reason as `_unit_corpus`.
    statement = (
        select(OrganigramHolder)
        .join(OrganigramUnit, OrganigramUnit.id == OrganigramHolder.unit_id)
        .where(OrganigramUnit.active)
        .order_by(OrganigramHolder.id)
    )
    if current_only:
        statement = statement.where(OrganigramHolder.is_current)
    else:
        statement = statement.where(~OrganigramHolder.is_current)
    return list(session.exec(statement).all())


def _rows_cache_context(rows: list, texts: list[str]) -> str:
    """Content-hash context for the embeddings cache: changes whenever any
    row in the corpus is added, removed, edited, or reordered -- editing the
    organigram naturally invalidates any cached vector built from a stale
    snapshot.

    Deliberately order-SENSITIVE: cached vectors are positionally aligned to
    this corpus, so a key that ignored order could hit an entry built from a
    different sequence and pair every row with another row's vector -- every
    downstream score wrong, with no error. `_unit_corpus`/`_holder_corpus`
    carry a matching `ORDER BY id` so the order is stable across calls.
    """
    fingerprint = tuple(zip((str(r.id) for r in rows), texts))
    return get_cache_key(fingerprint, context=EMBEDDING_ENCODER_NAME)


def _get_or_build_embeddings(rows: list, texts: list[str]) -> np.ndarray:
    if not rows:
        return np.zeros((0, 1))

    key = _rows_cache_context(rows, texts)
    cached = cache_load(key)
    if cached is not None:
        return cached

    encoder = _get_encoder()
    vectors = _l2_normalize(
        encoder.batch_encode(texts, encoder_type="response_encoder", batch_size=256)
    )
    cache_save(vectors, key)
    return vectors


def _fuzzy_scores_0_100(query_clean: str, choices: list[str]) -> np.ndarray:
    if not choices:
        return np.zeros(0)
    return np.asarray(
        process.cdist([query_clean], choices, scorer=fuzz.token_set_ratio)[0],
        dtype=np.float64,
    )


def _embedding_scores_0_100(query_clean: str, vectors: np.ndarray) -> np.ndarray:
    if vectors.shape[0] == 0:
        return np.zeros(0)
    encoder = _get_encoder()
    query_vector = encoder.encode([query_clean], encoder_type="question_encoder")[0]
    query_vector = query_vector / max(np.linalg.norm(query_vector), 1e-9)
    cosine = vectors @ query_vector
    return np.clip(cosine, 0.0, 1.0) * 100


def _combined_scores(
    fuzzy: np.ndarray,
    embeddings: np.ndarray,
    *,
    backend: SearchBackend,
    hybrid_weight: float,
) -> np.ndarray:
    if backend == "fuzzy":
        return fuzzy
    if backend == "embeddings":
        return embeddings
    return hybrid_weight * embeddings + (1 - hybrid_weight) * fuzzy


def disambiguate_by_parent_chain(
    candidates: list[tuple[OrganigramUnit, float]],
    raw_position: str,
    session: Session,
) -> OrganigramUnit | None:
    """
    Among tied/near-tied top candidates, picks the one whose parent chain has
    an exact-name match inside the raw (uncleaned) extracted position text --
    `clean_cargo` strips the parent-institution chain to match on the role
    itself, so a role that's identical across many units (e.g. several
    "Dirección General Técnica, Administrativa y Legal", one per ministry)
    can only be told apart this way.

    Args:
        candidates (list[tuple[OrganigramUnit, float]]): Top-ranked candidates,
            best first.
        raw_position (str): The extracted position text, uncleaned.
        session (Session): Database session, to walk each candidate's ancestors.

    Returns:
        OrganigramUnit | None: The disambiguated unit, or None if zero or more
            than one candidate's parent chain matches (still ambiguous).
    """
    if not candidates:
        return None

    normalized_position = normalize_text(raw_position)
    matches = []
    for unit, _ in candidates:
        for ancestor in ancestor_chain(unit, session):
            if (
                normalize_text(ancestor.name)
                and normalize_text(ancestor.name) in normalized_position
            ):
                matches.append(unit)
                break

    if len(matches) == 1:
        return matches[0]
    return None


def match_cargo(
    position_text: str,
    session: Session,
    *,
    backend: SearchBackend = "hybrid",
    top_k: int = 5,
    hybrid_weight: float = 0.25,
) -> list[tuple[OrganigramUnit, float]]:
    """
    Ranks active organigram units against an extracted position/cargo text.

    Args:
        position_text (str): Raw extracted `position` text.
        session (Session): Database session.
        backend (SearchBackend): "fuzzy", "embeddings", or "hybrid".
        top_k (int): Max candidates to return.
        hybrid_weight (float): Embeddings weight when backend="hybrid".

    Returns:
        list[tuple[OrganigramUnit, float]]: Ranked (unit, score 0-100), best
            first, disambiguated by parent chain among the top candidates.
    """
    units = _unit_corpus(session)
    if not units or not position_text:
        return []

    query_clean = clean_cargo(position_text)
    choices = [clean_cargo(u.name) for u in units]

    fuzzy = (
        _fuzzy_scores_0_100(query_clean, choices)
        if backend != "embeddings"
        else np.zeros(len(units))
    )
    embeddings = (
        _embedding_scores_0_100(query_clean, _get_or_build_embeddings(units, choices))
        if backend != "fuzzy"
        else np.zeros(len(units))
    )
    scores = _combined_scores(
        fuzzy, embeddings, backend=backend, hybrid_weight=hybrid_weight
    )

    order = np.argsort(-scores)[:top_k]
    ranked = [(units[i], float(scores[i])) for i in order]

    # Only disambiguate genuine ties at the top -- a clear single winner
    # (e.g. an exact match) must never be second-guessed by a lower-ranked
    # candidate that merely happens to mention the same parent institution.
    top_score = ranked[0][1]
    tied = [c for c in ranked if c[1] == top_score]
    if len(tied) > 1:
        disambiguated = disambiguate_by_parent_chain(tied, position_text, session)
        if disambiguated is not None and ranked[0][0].id != disambiguated.id:
            score = next(score for unit, score in ranked if unit.id == disambiguated.id)
            ranked = [
                (disambiguated, score),
                *[c for c in ranked if c[0].id != disambiguated.id],
            ]

    return ranked


def _best_holder_match(
    name_text: str,
    holders: list[OrganigramHolder],
    *,
    backend: SearchBackend,
    hybrid_weight: float,
) -> tuple[OrganigramHolder, float] | None:
    if not holders or not name_text:
        return None

    query_clean = normalize_text(name_text)
    choices = [normalize_text(h.name) for h in holders]

    fuzzy = (
        _fuzzy_scores_0_100(query_clean, choices)
        if backend != "embeddings"
        else np.zeros(len(holders))
    )
    embeddings = (
        _embedding_scores_0_100(query_clean, _get_or_build_embeddings(holders, choices))
        if backend != "fuzzy"
        else np.zeros(len(holders))
    )
    scores = _combined_scores(
        fuzzy, embeddings, backend=backend, hybrid_weight=hybrid_weight
    )

    best_index = int(np.argmax(scores))
    return holders[best_index], float(scores[best_index])


def match_name(
    name_text: str,
    session: Session,
    *,
    backend: SearchBackend = "hybrid",
    hybrid_weight: float = 0.25,
    threshold: float,
) -> tuple[OrganigramHolder, float] | None:
    """
    Matches an extracted recipient name against organigram holders: current
    holders first, falling back to past holders only when no current holder
    clears `threshold`.

    Args:
        name_text (str): Raw extracted `name` text.
        session (Session): Database session.
        backend (SearchBackend): "fuzzy", "embeddings", or "hybrid".
        hybrid_weight (float): Embeddings weight when backend="hybrid".
        threshold (float): Score (0-100) a current holder must clear to be
            used without falling back to past holders.

    Returns:
        tuple[OrganigramHolder, float] | None: Best match, or None if there
            are no holders at all.
    """
    current = _best_holder_match(
        name_text,
        _holder_corpus(session, current_only=True),
        backend=backend,
        hybrid_weight=hybrid_weight,
    )
    if current is not None and current[1] >= threshold:
        return current

    past = _best_holder_match(
        name_text,
        _holder_corpus(session, current_only=False),
        backend=backend,
        hybrid_weight=hybrid_weight,
    )
    candidates = [c for c in (current, past) if c is not None]
    if not candidates:
        return None
    return max(candidates, key=lambda c: c[1])


def resolve_recipient_unit(
    name: str | None,
    position: str | None,
    macro_sector_name: str | None,
    session: Session,
) -> RecipientMatch:
    """
    Resolves a recipient's `organigram_unit`/sector: gated to macro sectors
    whose `code` is "GCBA" (never the display label, which is editable).
    Tries, in order: the learned index (a human-confirmed match for this
    exact name/position, still pointing at an active unit), the position
    against organigram units, then the name against organigram holders as a
    fallback. The first to clear its threshold wins; position takes priority
    over name so a name that merely resembles someone else's can't override a
    confident cargo match.

    `sector_candidates` is always ranked fresh against the *current*
    organigram regardless of which of the above resolves `unit_id`/
    `sector_id` -- even a learned match should still let a human see (and
    pick from) today's real alternatives.

    Args:
        name (str | None): Extracted recipient name.
        position (str | None): Extracted recipient position.
        macro_sector_name (str | None): Extracted recipient macro sector label.
        session (Session): Database session.

    Returns:
        RecipientMatch: Resolved unit/sector (all-None if nothing cleared its
            threshold), plus the ranked sector candidates.
    """
    macro_sector = session.exec(
        select(MacroSector).where(MacroSector.name == macro_sector_name)
    ).first()
    if macro_sector is None or macro_sector.code != "GCBA":
        return RecipientMatch()

    backend = settings.DATA_EXTRACTION_SEARCH_BACKEND
    hybrid_weight = settings.DATA_EXTRACTION_HYBRID_WEIGHT

    # Matching the full cargo text against specific *unit* names is the
    # proven-strong signal (it's what auto-resolve itself uses) -- a human
    # validates a *sector*, so candidates are sectors too, but they're
    # derived by walking each well-matching unit up to its nearest
    # `is_sector` ancestor, never by matching directly against bare sector
    # names (far weaker signal: a sector name alone is short, and the
    # parent-institution text `clean_cargo` strips out of the query to match
    # units is exactly the part that would be needed to match a sector).
    # A wider pool than the final top-k gives the dedup something to work
    # with, since several well-scoring units often collapse into one sector.
    unit_pool = match_cargo(
        position or "",
        session,
        backend=backend,
        top_k=max(settings.DATA_EXTRACTION_TOP_K * 5, 25),
        hybrid_weight=hybrid_weight,
    )
    sector_candidates = _sector_candidates_from_units(
        unit_pool, session, top_k=settings.DATA_EXTRACTION_TOP_K
    )
    cargo_candidates = unit_pool[: settings.DATA_EXTRACTION_TOP_K]

    learned = recipient_learned_index_lookup(
        normalize_text(name) or None, normalize_text(position) or None, session
    )
    if learned is not None:
        # Read what the human actually confirmed, verbatim -- never
        # recomputed, so an organigram edit made since that validation can't
        # silently swap in a different sector than the one they picked.
        unit = session.get(OrganigramUnit, learned.unit_id)
        sector = (
            session.get(OrganigramUnit, learned.sector_id)
            if learned.sector_id
            else None
        )
        return RecipientMatch(
            unit_id=unit.id if unit else None,
            unit_name=unit.name if unit else None,
            sector_id=sector.id if sector else None,
            sector_name=sector.name if sector else None,
            method="cargo",
            sector_candidates=sector_candidates,
        )

    if (
        cargo_candidates
        and cargo_candidates[0][1] >= settings.DATA_EXTRACTION_POSITION_SCORE_THRESHOLD
    ):
        unit = cargo_candidates[0][0]
        sector = resolve_sector(unit, session)
        return RecipientMatch(
            unit_id=unit.id,
            unit_name=unit.name,
            sector_id=sector.id if sector else None,
            sector_name=sector.name if sector else None,
            method="cargo",
            sector_candidates=sector_candidates,
        )

    name_match = match_name(
        name or "",
        session,
        backend=backend,
        hybrid_weight=hybrid_weight,
        threshold=settings.DATA_EXTRACTION_NAME_SCORE_THRESHOLD,
    )
    if name_match is not None:
        holder, score = name_match
        weighted = score * settings.DATA_EXTRACTION_NAME_EVIDENCE_WEIGHT
        if weighted >= settings.DATA_EXTRACTION_NAME_SCORE_THRESHOLD:
            unit = holder.unit
            sector = resolve_sector(unit, session)
            return RecipientMatch(
                unit_id=unit.id,
                unit_name=unit.name,
                sector_id=sector.id if sector else None,
                sector_name=sector.name if sector else None,
                method="name",
                sector_candidates=sector_candidates,
            )

    return RecipientMatch(sector_candidates=sector_candidates)


def _sector_candidates_from_units(
    ranked: list[tuple[OrganigramUnit, float]], session: Session, *, top_k: int
) -> list[OrganigramCandidate]:
    """
    Collapses ranked unit matches into ranked, deduplicated sectors: each
    unit's score is attributed to its nearest `is_sector` ancestor, keeping
    the best score seen per sector.

    Args:
        ranked (list[tuple[OrganigramUnit, float]]): Ranked unit matches,
            best first (a wider pool than `top_k`, so distinct sectors have
            something to surface even when several units collapse into one).
        session (Session): Database session.
        top_k (int): Max distinct sectors to return.

    Returns:
        list[OrganigramCandidate]: Ranked, deduplicated sector candidates.
    """
    best_by_sector: dict[uuid.UUID, tuple[OrganigramUnit, float]] = {}
    for unit, score in ranked:
        sector = resolve_sector(unit, session)
        if sector is None:
            continue
        current = best_by_sector.get(sector.id)
        if current is None or score > current[1]:
            best_by_sector[sector.id] = (sector, score)

    ordered = sorted(best_by_sector.values(), key=lambda pair: -pair[1])[:top_k]
    return [
        OrganigramCandidate(
            unit_id=sector.id,
            unit_name=sector.name,
            sector_name=sector.name,
            ruta_organigrama=ruta_organigrama(sector, session),
            score=score,
        )
        for sector, score in ordered
    ]
