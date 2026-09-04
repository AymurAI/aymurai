import uuid

import pytest

from aymurai.api.endpoints.routers.llm.organigram_matching import (
    match_cargo,
    match_name,
    resolve_recipient_unit,
)
from aymurai.database.crud.dataset import get_or_create_default_dataset
from aymurai.database.schema import (
    MacroSector,
    OrganigramHolder,
    OrganigramUnit,
    Recipient,
    Recommendation,
)
from aymurai.settings import settings


@pytest.fixture(autouse=True)
def _fuzzy_only_backend(monkeypatch):
    # resolve_recipient_unit always reads settings.DATA_EXTRACTION_SEARCH_BACKEND
    # (it has no backend= override) -- force "fuzzy" so these tests never load
    # the real sentence-transformers model. The dedicated embeddings/cache test
    # opts back into the real backend explicitly.
    monkeypatch.setattr(settings, "DATA_EXTRACTION_SEARCH_BACKEND", "fuzzy")


def _unit(session, name, *, parent_id=None, is_sector=False) -> OrganigramUnit:
    unit = OrganigramUnit(
        id=uuid.uuid4(), name=name, parent_id=parent_id, is_sector=is_sector
    )
    session.add(unit)
    session.commit()
    session.refresh(unit)
    return unit


def _holder(session, unit_id, name, *, is_current=True) -> OrganigramHolder:
    holder = OrganigramHolder(unit_id=unit_id, name=name, is_current=is_current)
    session.add(holder)
    session.commit()
    session.refresh(holder)
    return holder


def _macro_sector(session, *, code="GCBA", name="GCBA") -> MacroSector:
    macro_sector = MacroSector(code=code, name=name)
    session.add(macro_sector)
    session.commit()
    return macro_sector


def _learned_recipient(
    session, *, name, position, unit_id, sector_id, macro_sector_id=None
) -> Recipient:
    """A previously human-validated recipient row, exactly what the learned
    index (`recipient_learned_index_lookup`) reads back."""
    from aymurai.text.matching import normalize_text

    dataset = get_or_create_default_dataset(session)
    recommendation = Recommendation(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        document_id=uuid.uuid4(),
        publishable_content="Contenido.",
    )
    session.add(recommendation)
    session.commit()

    recipient = Recipient(
        id=uuid.uuid4(),
        recommendation_id=recommendation.id,
        order=0,
        raw_name=name,
        raw_position=position,
        normalized_name=normalize_text(name) or None,
        normalized_position=normalize_text(position) or None,
        is_primary=True,
        macro_sector_id=macro_sector_id,
        unit_id=unit_id,
        sector_id=sector_id,
    )
    session.add(recipient)
    session.commit()
    return recipient


@pytest.fixture
def dgtal_tree(session):
    """
    Two ministries, each with a homonymous "Dirección General Técnica,
    Administrativa y Legal" -- the case `clean_cargo` alone can't resolve,
    since it strips the parent-institution chain from the compared text.
    """
    educacion = _unit(session, "Ministerio de Educación", is_sector=True)
    salud = _unit(session, "Ministerio de Salud", is_sector=True)
    dgtal_educacion = _unit(
        session,
        "Dirección General Técnica, Administrativa y Legal",
        parent_id=educacion.id,
    )
    dgtal_salud = _unit(
        session,
        "Dirección General Técnica, Administrativa y Legal",
        parent_id=salud.id,
    )
    return {
        "educacion": educacion,
        "salud": salud,
        "dgtal_educacion": dgtal_educacion,
        "dgtal_salud": dgtal_salud,
    }


def test_dgtal_homonyms_are_disambiguated_by_parent_chain(session, dgtal_tree):
    candidates = match_cargo(
        "Dirección General Técnica, Administrativa y Legal del Ministerio de Salud",
        session,
        backend="fuzzy",
        top_k=5,
    )

    assert candidates
    assert candidates[0][0].id == dgtal_tree["dgtal_salud"].id


def test_dgtal_homonyms_disambiguate_to_the_other_ministry_too(session, dgtal_tree):
    candidates = match_cargo(
        "Dirección General Técnica, Administrativa y Legal del Ministerio de Educación",
        session,
        backend="fuzzy",
        top_k=5,
    )

    assert candidates
    assert candidates[0][0].id == dgtal_tree["dgtal_educacion"].id


def test_threshold_rejects_a_known_negative(session, dgtal_tree):
    candidates = match_cargo(
        "Secretario de Deportes", session, backend="fuzzy", top_k=5
    )

    assert candidates
    assert candidates[0][1] < 85  # settings.DATA_EXTRACTION_POSITION_SCORE_THRESHOLD


def test_resolve_recipient_unit_gate_uses_code_not_label(session, dgtal_tree):
    _macro_sector(session, code="GCBA", name="Ciudad de Buenos Aires")  # renamed label

    match = resolve_recipient_unit(
        "Alguien",
        "Ministerio de Salud",
        "Ciudad de Buenos Aires",
        session,
    )

    assert match.unit_id == dgtal_tree["salud"].id


def test_resolve_recipient_unit_gate_rejects_same_label_different_code(
    session, dgtal_tree
):
    _macro_sector(session, code="OTRO", name="GCBA")  # literal "GCBA" label, wrong code

    match = resolve_recipient_unit("Alguien", "Ministerio de Salud", "GCBA", session)

    assert match.unit_id is None


def test_match_name_falls_back_to_past_holder(session, dgtal_tree):
    unit = dgtal_tree["salud"]
    _holder(session, unit.id, "Titular Actual Sin Relacion", is_current=True)
    _holder(session, unit.id, "Maria Fernandez Rodriguez", is_current=False)

    match = match_name(
        "Maria Fernandez Rodriguez", session, backend="fuzzy", threshold=90
    )

    assert match is not None
    holder, score = match
    assert holder.name == "Maria Fernandez Rodriguez"
    assert score >= 90


def test_resolve_recipient_unit_falls_back_to_name_when_cargo_is_weak(
    session, dgtal_tree
):
    _macro_sector(session)
    unit = dgtal_tree["salud"]
    _holder(session, unit.id, "Maria Fernandez Rodriguez", is_current=True)

    match = resolve_recipient_unit(
        "Maria Fernandez Rodriguez",
        "un cargo que no se parece a nada del organigrama",
        "GCBA",
        session,
    )

    assert match.unit_id == unit.id
    assert match.method == "name"


def test_resolve_recipient_unit_returns_none_when_nothing_clears_threshold(
    session, dgtal_tree
):
    _macro_sector(session)

    match = resolve_recipient_unit(
        "Persona Totalmente Desconocida",
        "un cargo que no se parece a nada del organigrama",
        "GCBA",
        session,
    )

    assert match.unit_id is None
    assert match.sector_id is None
    assert match.method is None
    assert match.sector_candidates  # still surfaced for a human to pick from by hand


def test_sector_candidates_only_include_is_sector_nodes(session, dgtal_tree):
    _macro_sector(session)

    match = resolve_recipient_unit(
        "Alguien",
        "Director General Técnica, Administrativa y Legal del Ministerio de Salud",
        "GCBA",
        session,
    )

    # auto-resolve still picks the most specific match (a human validates the
    # *sector*, but auto-resolve keeps returning the precise unit).
    assert match.unit_id == dgtal_tree["dgtal_salud"].id

    seen_units = {c.unit_name for c in match.sector_candidates}
    assert "Dirección General Técnica, Administrativa y Legal" not in seen_units
    assert "Ministerio de Salud" in seen_units

    # every candidate is itself a sector -- resolve_sector(unit) == unit.
    for candidate in match.sector_candidates:
        assert candidate.unit_name == candidate.sector_name


def test_candidates_are_still_returned_alongside_a_confident_match(session, dgtal_tree):
    _macro_sector(session)

    match = resolve_recipient_unit("Alguien", "Ministerio de Salud", "GCBA", session)

    assert match.unit_id == dgtal_tree["salud"].id
    assert (
        match.sector_candidates
    )  # ranked alternatives kept even on a clean auto-resolve


@pytest.mark.slow
def test_embeddings_cache_is_invalidated_when_organigram_is_edited(session, dgtal_tree):
    from aymurai.api.endpoints.routers.llm.organigram_matching import (
        _get_or_build_embeddings,
        clean_cargo,
    )

    unit = dgtal_tree["educacion"]
    choices = [clean_cargo(unit.name)]
    vectors_before = _get_or_build_embeddings([unit], choices)

    unit.name = "Ministerio de Educación Renombrado"
    session.add(unit)
    session.commit()
    session.refresh(unit)

    choices_after = [clean_cargo(unit.name)]
    vectors_after = _get_or_build_embeddings([unit], choices_after)

    assert not (
        vectors_before.shape == vectors_after.shape
        and (vectors_before == vectors_after).all()
    )

    candidates = match_cargo(
        "Ministerio de Educación Renombrado", session, backend="embeddings", top_k=5
    )
    assert candidates
    assert candidates[0][0].id == unit.id
    assert candidates[0][1] > 50


def test_learned_index_reads_stored_sector_verbatim_not_recomputed(session, dgtal_tree):
    """The learned index must return exactly the sector a human confirmed,
    even if the organigram's tree has changed since (here: `direccion` is
    reparented to `salud` after the recipient was validated against
    `educacion`) -- never silently recompute it against the current tree."""
    _macro_sector(session)
    direccion = dgtal_tree["dgtal_educacion"]
    _learned_recipient(
        session,
        name="Alguien",
        position="un cargo cualquiera",
        unit_id=direccion.id,
        sector_id=dgtal_tree["educacion"].id,
    )

    # The organigram reorganizes after that validation: `direccion` now
    # belongs to `salud`, whose sector `resolve_sector` would compute today.
    direccion.parent_id = dgtal_tree["salud"].id
    session.add(direccion)
    session.commit()

    match = resolve_recipient_unit("Alguien", "un cargo cualquiera", "GCBA", session)

    assert match.unit_id == direccion.id
    assert match.sector_id == dgtal_tree["educacion"].id  # stored, not recomputed


def test_learned_index_still_returns_sector_candidates(session, dgtal_tree):
    _macro_sector(session)
    _learned_recipient(
        session,
        name="Alguien",
        position="Ministerio de Salud",
        unit_id=dgtal_tree["salud"].id,
        sector_id=dgtal_tree["salud"].id,
    )

    match = resolve_recipient_unit("Alguien", "Ministerio de Salud", "GCBA", session)

    assert match.unit_id == dgtal_tree["salud"].id
    assert match.sector_candidates  # ranked fresh, even on a learned hit


def test_learned_index_skips_a_deactivated_unit(session, dgtal_tree):
    _macro_sector(session)
    unit = dgtal_tree["dgtal_salud"]
    _learned_recipient(
        session,
        name="Alguien",
        position="un cargo cualquiera",
        unit_id=unit.id,
        sector_id=dgtal_tree["salud"].id,
    )
    unit.active = False
    session.add(unit)
    session.commit()

    match = resolve_recipient_unit("Alguien", "un cargo cualquiera", "GCBA", session)

    # falls through to the fresh search instead of reusing the stale match --
    # "un cargo cualquiera" doesn't clear any threshold, so nothing resolves.
    assert match.unit_id is None


def test_sector_candidates_resolve_via_a_disambiguated_unit_match(session, dgtal_tree):
    """Sector candidates come from walking well-matching *units* up to their
    `is_sector` ancestor -- here the cargo text matches both DGTAL homonyms
    almost exactly, so the parent-chain disambiguation (same mechanism
    auto-resolve relies on) must pick `dgtal_salud`, and its sector
    ("Ministerio de Salud") must rank first as a result."""
    _macro_sector(session)

    match = resolve_recipient_unit(
        "Alguien",
        "Directora General Técnica, Administrativa y Legal, dependiente del "
        "Ministerio de Salud del Gobierno de la Ciudad Autónoma de Buenos Aires",
        "GCBA",
        session,
    )

    assert match.sector_candidates[0].unit_name == "Ministerio de Salud"
    assert match.sector_candidates[0].score > 90


def test_sector_candidates_carry_the_sector_id(session, dgtal_tree):
    """A candidate must name its sector by id, not only by label.

    The validation form sends `unit_id` and `sector_id` together; without the
    id the client would have to resolve a display name back to a row, and
    `_reconcile_recipients` stores `sector_id=None` for a request that omits
    it -- silently blanking SECTOR_FINAL in the export.
    """
    _macro_sector(session)

    match = resolve_recipient_unit(
        name=None,
        position=(
            "Directora General Obras en Vías Peatonales, dependiente del "
            "Ministerio de Salud"
        ),
        macro_sector_name="GCBA",
        session=session,
    )

    assert match.sector_candidates, "expected at least one ranked candidate"
    for candidate in match.sector_candidates:
        assert candidate.sector_id is not None
        sector = session.get(OrganigramUnit, candidate.sector_id)
        assert sector is not None
        assert sector.is_sector is True
        assert sector.name == candidate.sector_name


def test_embeddings_cache_key_is_order_sensitive():
    """The cached vectors are positionally aligned to the corpus, so two
    different orderings of the same rows must not share a cache key.

    Reaches for the private `_rows_cache_context` deliberately, against the
    house rule of testing through the public seam (CES-65): the invariant
    *is* this key function, and no public seam can distinguish "same rows,
    different order" without stubbing the sentence-transformers encoder.
    """
    from aymurai.api.endpoints.routers.llm.organigram_matching import (
        _rows_cache_context,
    )

    class _Row:
        def __init__(self, id_):
            self.id = id_

    a, b = _Row(uuid.uuid4()), _Row(uuid.uuid4())
    key_ab = _rows_cache_context([a, b], ["alfa", "beta"])
    key_ba = _rows_cache_context([b, a], ["beta", "alfa"])

    assert key_ab != key_ba
