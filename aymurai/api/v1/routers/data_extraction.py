import os
import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import Depends, HTTPException
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
from aymurai.api.exceptions import ConfigurationError, NotFoundError
from aymurai.api.v1.schemas.requests.data_extraction import (
    DataExtractionRequest,
    ValidateRecommendationRequest,
)
from aymurai.api.v1.schemas.responses.data_extraction import (
    DataExtractionConfigResponse,
    DataExtractionResponse,
    OrganigramCandidateResponse,
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
    RecommendationValidationData,
    recommendation_get,
    recommendation_list,
    recommendation_upsert,
)
from aymurai.database.schema import (
    LLMExtraction,
    MacroSector,
    OrganigramUnit,
    Recipient,
    Recommendation,
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
            return _response_from_record(existing, session)

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
        None,
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

    data = RecommendationValidationData(
        recommendation_number=payload.recommendation_number,
        recommendation_date_text=payload.recommendation_date_text,
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
            )
            for r in payload.recipients
        ],
    )
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

    return FileResponse(
        str(path),
        background=BackgroundTask(os.remove, str(path)),
        media_type=media_type,
        filename=f"recomendaciones.{format}",
    )
