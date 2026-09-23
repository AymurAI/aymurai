import os
import uuid
from datetime import date, datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import Depends, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.routing import APIRouter
from sqlmodel import Session, select
from starlette.background import BackgroundTask

from aymurai.api.endpoints.routers.llm.data_extraction_engine import (
    RawExtraction,
    build_response_schema,
    build_system_prompt,
    catalogs_hash,
    extract_with_retry,
    preflight,
)
from aymurai.api.endpoints.routers.llm.data_extraction_export import (
    build_destinatarios_rows,
    build_recomendaciones_rows,
    write_csv,
    write_xlsx,
)
from aymurai.api.endpoints.routers.llm.organigram_matching import resolve_recipient_unit
from aymurai.api.endpoints.routers.llm.summarization_engine import ContextTooSmallError
from aymurai.api.exceptions import (
    ConfigurationError,
    NotFoundError,
    PreconditionFailedError,
)
from aymurai.api.endpoints.schemas.requests.data_extraction import (
    CorrectRecommendationRequest,
    DataExtractionRequest,
    RecommendationSeguimientoUpdateRequest,
    ValidateRecommendationRequest,
)
from aymurai.api.endpoints.schemas.responses.data_extraction import (
    DataExtractionConfigResponse,
    DataExtractionResponse,
    DocumentExtractionEnvelopeResponse,
    OrganigramCandidateResponse,
    OrganigramUnitCandidateResponse,
    RecipientDetailResponse,
    RecipientResponse,
    RecommendationDetailResponse,
    RecommendationPageResponse,
    RecommendationResponse,
)
from aymurai.database.crud.catalogs.macro_sector import macro_sector_list
from aymurai.database.crud.catalogs.subtopic import subtopic_list
from aymurai.database.crud.catalogs.topic import topic_list
from aymurai.database.crud.llm_extraction import (
    llm_extraction_create_or_update,
    llm_extraction_get,
)
from aymurai.database.crud.recommendation import (
    InconsistentSectorError,
    OrganigramReferenceNotFoundError,
    RecipientValidationData,
    RecommendationOrderColumn,
    RecommendationValidationData,
    recommendation_get,
    recommendation_get_by_document,
    recommendation_list,
    recommendation_update_seguimiento,
    recommendation_upsert,
)
from aymurai.database.schema import (
    LLMExtraction,
    MacroSector,
    OrganigramUnit,
    Recipient,
    Recommendation,
    RecommendationUpdate,
    Subtopic,
    Topic,
)
from aymurai.database.session import get_session
from aymurai.llm_providers import LlamaCppLLMProvider
from aymurai.logger import get_logger
from aymurai.settings import settings

router = APIRouter()
logger = get_logger(__name__)

SessionDep = Annotated[Session, Depends(get_session)]


def _catalogs_snapshot(session: Session) -> tuple[dict[str, list[str]], list[str]]:
    topics = {
        topic.name: [sub.name for sub in subtopic_list(session, topic_id=topic.id)]
        for topic in topic_list(session)
    }
    macro_sector_names = [m.name for m in macro_sector_list(session)]
    return topics, macro_sector_names


def _recipient_response(raw: dict, session: Session) -> RecipientResponse:
    match = resolve_recipient_unit(
        raw.get("name"), raw.get("position"), raw.get("macro_sector"), session
    )
    return RecipientResponse(
        **raw,
        unit_id=match.unit_id,
        unit_name=match.unit_name,
        sector_id=match.sector_id,
        sector_name=match.sector_name,
        match_method=match.method,
        sector_candidates=[
            OrganigramCandidateResponse(**c.model_dump())
            for c in match.sector_candidates
        ],
        unit_candidates=[
            OrganigramUnitCandidateResponse(**c.model_dump())
            for c in match.unit_candidates
        ],
    )


def _response_from_record(
    record: LLMExtraction, session: Session
) -> DataExtractionResponse:
    prediction = record.prediction
    return DataExtractionResponse(
        document_id=record.id,
        recommendation_number=prediction.get("recommendation_number"),
        recommendation_date=prediction.get("recommendation_date"),
        recipients=[
            _recipient_response(r, session) for r in prediction.get("recipients", [])
        ],
        topic=prediction.get("topic"),
        subtopic=prediction.get("subtopic"),
        personal_data=prediction.get("personal_data"),
        publishable_content=prediction.get("publishable_content", ""),
        config=DataExtractionConfigResponse(**record.config),
    )


def _catalogs_stale(record: LLMExtraction, session: Session) -> bool:
    """
    Says whether an extraction was inferred against an outdated taxonomy.

    Args:
        record (LLMExtraction): The stored extraction.
        session (Session): Database session.

    Returns:
        bool: True when the stored hash differs from the live catalogs snapshot.
    """
    topics, macro_sector_names = _catalogs_snapshot(session)
    return record.config.get("catalogs_hash") != catalogs_hash(
        topics, macro_sector_names
    )


@router.post("/data-extraction", response_model=DataExtractionResponse)
async def api_data_extraction(
    payload: DataExtractionRequest,
    session: SessionDep,
    use_cache: bool = True,
):
    document_id = payload.document.document_id

    if use_cache:
        existing = llm_extraction_get(document_id, session)
        if existing:
            response = _response_from_record(existing, session)
            response.catalogs_stale = _catalogs_stale(existing, session)
            return response

    if not settings.LLAMACPP_BASE_URL:
        raise ConfigurationError(detail="LLAMACPP_BASE_URL is not configured")

    topics, macro_sector_names = _catalogs_snapshot(session)
    document_text = "\n".join(payload.document.document)
    system_prompt = build_system_prompt(topics, macro_sector_names)
    schema = build_response_schema(list(topics), macro_sector_names)

    provider = LlamaCppLLMProvider(model=payload.model)
    try:
        if not payload.model:
            served = await provider.aresolve_served_model()
            provider.model_name = served.id

        await preflight(
            provider,
            system_prompt=system_prompt,
            document_text=document_text,
            max_tokens=settings.DATA_EXTRACTION_MAX_TOKENS,
        )

        raw_extraction: RawExtraction
        raw_extraction, attempts = await extract_with_retry(
            provider,
            document_text=document_text,
            base_system_prompt=system_prompt,
            schema=schema,
            topics=topics,
            max_retries=settings.DATA_EXTRACTION_MAX_RETRIES,
            max_tokens=settings.DATA_EXTRACTION_MAX_TOKENS,
            extra_options=payload.options,
        )
    except ContextTooSmallError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await provider.aclose()

    config = {
        "model": provider.model_name,
        "options": {
            "max_tokens": settings.DATA_EXTRACTION_MAX_TOKENS,
            "attempts": attempts,
        },
        "catalogs_hash": catalogs_hash(topics, macro_sector_names),
    }

    record = llm_extraction_create_or_update(
        document_id,
        payload.document.file_name,
        document_text,
        raw_extraction.model_dump(),
        config,
        session,
    )
    return _response_from_record(record, session)


def _recipient_detail_response(
    recipient: Recipient, session: Session
) -> RecipientDetailResponse:
    macro_sector = (
        session.get(MacroSector, recipient.macro_sector_id)
        if recipient.macro_sector_id
        else None
    )
    unit = session.get(OrganigramUnit, recipient.unit_id) if recipient.unit_id else None
    sector = (
        session.get(OrganigramUnit, recipient.sector_id)
        if recipient.sector_id
        else None
    )
    return RecipientDetailResponse(
        id=recipient.id,
        source_index=recipient.source_index,
        name=recipient.raw_name,
        position=recipient.raw_position,
        is_primary=recipient.is_primary,
        macro_sector=macro_sector.name if macro_sector else None,
        unit_id=recipient.unit_id,
        unit_name=unit.name if unit else None,
        sector_id=recipient.sector_id,
        sector_name=sector.name if sector else None,
    )


def _recommendation_response(
    recommendation: Recommendation, session: Session
) -> RecommendationResponse:
    topic = (
        session.get(Topic, recommendation.topic_id) if recommendation.topic_id else None
    )
    subtopic = (
        session.get(Subtopic, recommendation.subtopic_id)
        if recommendation.subtopic_id
        else None
    )
    recipients = session.exec(
        select(Recipient)
        .where(Recipient.recommendation_id == recommendation.id)
        .order_by(Recipient.order)
    ).all()
    return RecommendationResponse(
        id=recommendation.id,
        document_id=recommendation.document_id,
        recommendation_number=recommendation.recommendation_number,
        recommendation_date_text=recommendation.recommendation_date_text,
        recommendation_date=recommendation.recommendation_date,
        topic=topic.name if topic else None,
        subtopic=subtopic.name if subtopic else None,
        personal_data=recommendation.personal_data,
        publishable_content=recommendation.publishable_content,
        recipients=[_recipient_detail_response(r, session) for r in recipients],
        file_number=recommendation.file_number,
        recommendation_detail=recommendation.recommendation_detail,
        recommendation_situation=recommendation.recommendation_situation,
        status=recommendation.status,
        approved_for_publication=recommendation.approved_for_publication,
        link=recommendation.link,
        created_at=recommendation.created_at,
        updated_at=recommendation.updated_at,
    )


def _recommendation_detail_response(
    recommendation: Recommendation, extraction: LLMExtraction | None, session: Session
) -> RecommendationDetailResponse:
    response = _recommendation_response(recommendation, session)
    return RecommendationDetailResponse(
        **response.model_dump(),
        source_text=extraction.source_text if extraction else "",
        prediction=extraction.prediction if extraction else {},
    )


def _validation_data(
    payload: ValidateRecommendationRequest,
) -> RecommendationValidationData:
    """
    Translates a validation payload into the CRUD layer's own input shape.

    Shared by `/validate` and the correction `PUT`: `CorrectRecommendationRequest`
    IS a `ValidateRecommendationRequest` (it inherits with no added fields), so
    both handlers need exactly this translation and had it duplicated
    character-for-character.

    Args:
        payload (ValidateRecommendationRequest): The request body.

    Returns:
        RecommendationValidationData: The CRUD-layer input for
            `recommendation_upsert`.
    """
    return RecommendationValidationData(
        recommendation_number=payload.recommendation_number,
        recommendation_date_text=payload.recommendation_date_text,
        recommendation_date=payload.recommendation_date,
        topic=payload.topic,
        subtopic=payload.subtopic,
        personal_data=payload.personal_data,
        publishable_content=payload.publishable_content,
        recipients=[
            RecipientValidationData(
                id=r.id,
                name=r.name,
                position=r.position,
                is_primary=r.is_primary,
                macro_sector=r.macro_sector,
                unit_id=r.unit_id,
                sector_id=r.sector_id,
                source_index=r.source_index,
            )
            for r in payload.recipients
        ],
    )


@router.put(
    "/data-extraction/{document_id}/validate",
    response_model=RecommendationDetailResponse,
)
async def api_data_extraction_validate(
    document_id: uuid.UUID, payload: ValidateRecommendationRequest, session: SessionDep
):
    extraction = llm_extraction_get(document_id, session)
    if not extraction:
        raise NotFoundError(detail=f"Extraction not found: {document_id}")

    data = _validation_data(payload)
    try:
        recommendation = recommendation_upsert(document_id, data, session)
    except (InconsistentSectorError, OrganigramReferenceNotFoundError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _recommendation_detail_response(recommendation, extraction, session)


@router.get(
    "/data-extraction/recommendations", response_model=RecommendationPageResponse
)
async def api_data_extraction_recommendations(
    session: SessionDep,
    topic_id: uuid.UUID | None = None,
    sector_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    unparsed_dates: bool = False,
    order_by: RecommendationOrderColumn = "created_at",
    order_dir: Literal["asc", "desc"] = "desc",
    page: int = 1,
    page_size: int = 20,
):
    items, total = recommendation_list(
        session,
        topic_id=topic_id,
        sector_id=sector_id,
        date_from=date_from,
        date_to=date_to,
        q=q,
        unparsed_dates=unparsed_dates,
        order_by=order_by,
        order_dir=order_dir,
        page=page,
        page_size=page_size,
    )
    return RecommendationPageResponse(
        items=[_recommendation_response(r, session) for r in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/data-extraction/recommendations/{recommendation_id}",
    response_model=RecommendationDetailResponse,
)
async def api_data_extraction_recommendation_detail(
    recommendation_id: uuid.UUID, session: SessionDep
):
    recommendation = recommendation_get(recommendation_id, session)
    if not recommendation:
        raise NotFoundError(detail=f"Recommendation not found: {recommendation_id}")

    extraction = llm_extraction_get(recommendation.document_id, session)
    return _recommendation_detail_response(recommendation, extraction, session)


@router.patch(
    "/data-extraction/recommendations/{recommendation_id}",
    response_model=RecommendationResponse,
)
async def api_data_extraction_recommendation_update_seguimiento(
    recommendation_id: uuid.UUID,
    payload: RecommendationSeguimientoUpdateRequest,
    session: SessionDep,
) -> RecommendationResponse:
    try:
        recommendation = recommendation_update_seguimiento(
            recommendation_id,
            RecommendationUpdate(**payload.model_dump(exclude_unset=True)),
            session,
        )
    except ValueError as exc:
        raise NotFoundError(detail=str(exc))
    return _recommendation_response(recommendation, session)


@router.put(
    "/data-extraction/recommendations/{recommendation_id}",
    response_model=RecommendationDetailResponse,
)
async def api_data_extraction_recommendation_correct(
    recommendation_id: uuid.UUID,
    payload: CorrectRecommendationRequest,
    session: SessionDep,
    if_match: Annotated[str, Header(alias="If-Match")],
) -> RecommendationDetailResponse:
    """
    Corrects the document-derived fields of an already-validated recommendation.

    Unlike `/validate`, this is keyed on the recommendation rather than the
    document and needs no re-upload: the row already exists, and the client is
    fixing what the extraction got wrong (tema, subtema, destinatarios,
    contenido publicable, número y fecha).

    `If-Match` is required, not optional: the correction screen can only send a
    whole replacement body, so a save built on a snapshot somebody else has
    already replaced would silently undo their work. Making the header
    mandatory means a client cannot opt out of the check by omitting it.

    Args:
        recommendation_id (uuid.UUID): The row to correct.
        payload (CorrectRecommendationRequest): The full replacement body.
        session (Session): Database session.
        if_match (str): The `updated_at`/`created_at` etag the client last read.

    Returns:
        RecommendationDetailResponse: The corrected row, with a fresh etag.
    """
    recommendation = recommendation_get(recommendation_id, session)
    if not recommendation:
        raise NotFoundError(detail=f"Recommendation not found: {recommendation_id}")

    # Parsed to a `datetime` and compared as one, NEVER string-compared: the
    # same instant has several equally valid ISO-8601 spellings (trailing `Z`
    # vs. `+00:00`, microseconds present or truncated, a `T` vs. a space
    # separator). This exact drift already bit the same two columns once --
    # b84d8ace fixed a grilla date rendered a day off because the API
    # serializes these timestamps NAIVE while the client fixtures carried a
    # fabricated `Z`. Under a string comparison that mismatch becomes a
    # spurious 412 on a save nobody else raced.
    try:
        expected = datetime.fromisoformat(if_match)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Malformed If-Match header: {if_match}"
        ) from exc

    # `updated_at` is `onupdate`-only with no `server_default`, so it stays
    # NULL until the row's first edit -- a never-corrected recommendation has
    # only `created_at` to identify its version by. Same fallback the client
    # applies when it picks the etag to send, so the two always agree.
    current = recommendation.updated_at or recommendation.created_at
    if expected != current:
        # 412, per RFC 7232: a failed `If-Match` precondition is exactly what
        # this status means. Not 409 (which says the request conflicts with
        # the resource's state, when the request itself is fine and only its
        # precondition failed) and not 404 (the row is right here). The client
        # keys its "recargá los datos" branch off this status.
        raise PreconditionFailedError(
            detail="Recommendation was modified since it was last read"
        )

    # Upsert by `document_id`, not by `recommendation_id`: one document has at
    # most one recommendation, so this reuses `/validate`'s single write path
    # rather than growing a second, divergent one.
    data = _validation_data(payload)
    try:
        recommendation = recommendation_upsert(
            recommendation.document_id, data, session
        )
    except (InconsistentSectorError, OrganigramReferenceNotFoundError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    extraction = llm_extraction_get(recommendation.document_id, session)
    return _recommendation_detail_response(recommendation, extraction, session)


@router.get("/data-extraction/export")
async def api_data_extraction_export(
    session: SessionDep, format: Literal["xlsx", "csv"] = "xlsx"
) -> FileResponse:
    recomendaciones = build_recomendaciones_rows(session)

    if format == "csv":
        path = write_csv(recomendaciones)
        media_type = "text/csv"
    else:
        destinatarios = build_destinatarios_rows(session)
        path = write_xlsx(recomendaciones, destinatarios)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    timestamp = datetime.now(ZoneInfo(settings.EXPORT_TIMEZONE)).strftime(
        "%Y%m%d%H%M%S"
    )
    return FileResponse(
        str(path),
        background=BackgroundTask(os.remove, str(path)),
        media_type=media_type,
        filename=f"recomendaciones_{timestamp}.{format}",
    )


# Registered last, deliberately: `{document_id}` is a single generic path
# segment, matching the same shape as `/recommendations` and `/export` above.
# FastAPI/Starlette routes are tried in registration order and a path
# parameter's type (uuid.UUID here) is enforced *after* a route is selected,
# not encoded into the matching regex -- so if this route were registered
# first, GET .../recommendations and GET .../export would match it instead of
# their own literal routes, and 422 on failing to parse "recommendations" or
# "export" as a UUID (confirmed by running the full suite: both endpoints
# broke with exactly that 422 until this was moved here).
@router.get(
    "/data-extraction/{document_id}",
    response_model=DocumentExtractionEnvelopeResponse,
)
async def api_data_extraction_envelope(document_id: uuid.UUID, session: SessionDep):
    """
    Reports what is stored for a document without inferring anything.

    Pure read: the client asks this before deciding whether to spend an
    inference, and a failure here must stop the flow rather than fall through
    to a fresh extraction -- the historical client failed open and silently
    overwrote human validations with fresh model output.

    Args:
        document_id (uuid.UUID): Content-addressed document id.
        session (Session): Database session.

    Returns:
        DocumentExtractionEnvelopeResponse: Stored prediction and validation,
            either or both possibly null, plus catalog staleness.
    """
    extraction = llm_extraction_get(document_id, session)
    recommendation = recommendation_get_by_document(document_id, session)

    prediction = None
    stale = False
    if extraction:
        prediction = _response_from_record(extraction, session)
        stale = _catalogs_stale(extraction, session)
        prediction.catalogs_stale = stale

    validation = None
    if recommendation and extraction:
        validation = _recommendation_detail_response(
            recommendation, extraction, session
        )

    return DocumentExtractionEnvelopeResponse(
        document_id=document_id,
        prediction=prediction,
        validation=validation,
        catalogs_stale=stale,
        updated_at=extraction.updated_at if extraction else None,
    )
