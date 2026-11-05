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
from aymurai.text.cargo import clean_cargo
from aymurai.text.matching import normalize_text
from aymurai.utils.cache import cache_load, cache_save, get_cache_key

logger = get_logger(__name__)

SearchBackend = Literal["fuzzy", "embeddings", "hybrid"]
EMBEDDING_ENCODER_NAME = "minilm"


class OrganigramCandidate(BaseModel):
    """One ranked alternative for a recipient's `organigram_unit`."""

    unit_id: uuid.UUID
    unit_name: str
    sector_id: uuid.UUID | None = None
    sector_name: str | None = None
    ruta_organigrama: str
    score: float
    # The specific unit whose match against the cargo text produced this
    # sector (the best-scoring one, if several collapsed into it) -- submit
    # both together in `validate` (`unit_id=source_unit_id`,
    # `sector_id=this candidate's sector_id`) and the consistency check is
    # guaranteed to pass, since that's exactly how this pair was derived.
    source_unit_id: uuid.UUID | None = None
    source_unit_name: str | None = None


class OrganigramUnitCandidate(BaseModel):
    """
    One ranked *unit* match for a recipient's cargo -- not collapsed to its
    sector, unlike `OrganigramCandidate`.

    Every field means what it says here: `unit_id` is the unit, `sector_id`
    the sector containing it, and `ruta_organigrama` the unit's own path.
    Deliberately a separate model rather than a reuse of
    `OrganigramCandidate`, whose `unit_id` holds a *sector* id -- conflating
    the two is what made the form save `unit_id == sector_id` for every
    recipient.

    Submitting `unit_id` together with this row's `sector_id` always passes
    `_reconcile_recipients`' consistency check: the sector is `resolve_sector`
    of that same unit.
    """

    unit_id: uuid.UUID
    unit_name: str
    sector_id: uuid.UUID | None = None
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
    # The same ranking before it is collapsed to one row per sector, and
    # wider than `sector_candidates` on purpose. Once a human validates a
    # sector, the form narrows the unit field to that sector's units and
    # needs them ordered by how well each matches the cargo -- an order only
    # this side can produce (hybrid embeddings + fuzzy). Collapsing first
    # throws away every unit but the best one per sector, which is exactly
    # what such a filter needs.
    unit_candidates: list[OrganigramUnitCandidate] = []


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
    # The whole pool, not the top-k: once a sector is validated the form
    # filters these down to that sector's own units, and a top-5 cut usually
    # leaves nothing at all for whichever sector the person picked.
    unit_candidates = _unit_candidates_from_ranked(unit_pool, session)
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
            unit_candidates=unit_candidates,
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
            unit_candidates=unit_candidates,
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
                unit_candidates=unit_candidates,
            )

    return RecipientMatch(
        sector_candidates=sector_candidates,
        unit_candidates=unit_candidates,
    )


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
    best_by_sector: dict[uuid.UUID, tuple[OrganigramUnit, OrganigramUnit, float]] = {}
    for unit, score in ranked:
        sector = resolve_sector(unit, session)
        if sector is None:
            continue
        current = best_by_sector.get(sector.id)
        if current is None or score > current[2]:
            best_by_sector[sector.id] = (sector, unit, score)

    ordered = sorted(best_by_sector.values(), key=lambda triple: -triple[2])[:top_k]
    return [
        OrganigramCandidate(
            unit_id=sector.id,
            unit_name=sector.name,
            sector_id=sector.id,
            sector_name=sector.name,
            ruta_organigrama=ruta_organigrama(sector, session),
            score=score,
            source_unit_id=source_unit.id,
            source_unit_name=source_unit.name,
        )
        for sector, source_unit, score in ordered
    ]


def _unit_candidates_from_ranked(
    ranked: list[tuple[OrganigramUnit, float]],
    session: Session,
) -> list[OrganigramUnitCandidate]:
    """
    The ranked units as they are, each paired with the sector that contains
    it -- no dedup, no collapsing.

    Args:
        ranked (list[tuple[OrganigramUnit, float]]): Ranked unit matches,
            best first.
        session (Session): Database session.

    Returns:
        list[OrganigramUnitCandidate]: Ranked unit candidates, best first.
    """
    candidates = []
    for unit, score in ranked:
        # `OrganigramUnit.id` is Optional on the model (it is only assigned on
        # flush), but every unit here came back from a query, so this narrows
        # rather than filters.
        if unit.id is None:
            continue
        sector = resolve_sector(unit, session)
        candidates.append(
            OrganigramUnitCandidate(
                unit_id=unit.id,
                unit_name=unit.name,
                sector_id=sector.id if sector else None,
                sector_name=sector.name if sector else None,
                ruta_organigrama=ruta_organigrama(unit, session),
                score=score,
            )
        )
    return candidates
