import uuid
from typing import Annotated

from fastapi import Depends
from fastapi.routing import APIRouter
from sqlmodel import Session

from aymurai.api.exceptions import ConflictError, NotFoundError
from aymurai.api.v1.schemas.requests.catalogs import (
    MacroSectorUpdateRequest,
    SubtopicCreateRequest,
    SubtopicReassignRequest,
    SubtopicUpdateRequest,
    TopicCreateRequest,
    TopicUpdateRequest,
)
from aymurai.api.v1.schemas.responses.catalogs import (
    MacroSectorResponse,
    ReassignResponse,
    SubtopicResponse,
    TopicResponse,
    UsageResponse,
)
from aymurai.database.crud.catalogs.macro_sector import (
    macro_sector_deactivate,
    macro_sector_get,
    macro_sector_list,
    macro_sector_update,
)
from aymurai.database.crud.catalogs.subtopic import (
    subtopic_create,
    subtopic_deactivate,
    subtopic_get,
    subtopic_list,
    subtopic_reassign,
    subtopic_update,
    subtopic_usage_count,
)
from aymurai.database.crud.catalogs.topic import (
    topic_create,
    topic_deactivate,
    topic_get,
    topic_list,
    topic_update,
    topic_usage_count,
)
from aymurai.database.schema import (
    MacroSectorUpdate,
    SubtopicCreate,
    SubtopicUpdate,
    TopicCreate,
    TopicUpdate,
)
from aymurai.database.session import get_session

router = APIRouter()

SessionDep = Annotated[Session, Depends(get_session)]


def _integrity_error_is_duplicate(
    exc: Exception, *, constraint: str | None = None
) -> bool:
    """
    Checks whether `exc` is a unique-constraint violation.

    Args:
        exc (Exception): The exception raised by the failed write.
        constraint (str | None): When given, only match this specific
            constraint. The subtopic table has two (`code`, and the composite
            `(topic_id, name)`), and reporting a name collision as a `code`
            conflict misleads the client into changing the wrong field.

    Returns:
        bool: True when `exc` is a matching unique-constraint violation.
    """
    message = str(exc)
    if "UNIQUE constraint failed" not in message:
        return False
    return constraint is None or constraint in message


# -- Topics -------------------------------------------------------------


@router.post("/topics", response_model=TopicResponse)
async def api_topic_create(payload: TopicCreateRequest, session: SessionDep):
    try:
        topic = topic_create(TopicCreate(**payload.model_dump()), session)
    except Exception as exc:
        session.rollback()
        if _integrity_error_is_duplicate(exc):
            raise ConflictError(detail=f"Topic code already exists: {payload.code}")
        raise
    return TopicResponse(**topic.model_dump())


@router.get("/topics", response_model=list[TopicResponse])
async def api_topic_list(session: SessionDep, include_inactive: bool = False):
    topics = topic_list(session, include_inactive=include_inactive)
    return [TopicResponse(**t.model_dump()) for t in topics]


@router.get("/topics/{topic_id}", response_model=TopicResponse)
async def api_topic_read(topic_id: uuid.UUID, session: SessionDep):
    topic = topic_get(topic_id, session)
    if not topic:
        raise NotFoundError(detail=f"Topic not found: {topic_id}")
    return TopicResponse(**topic.model_dump())


@router.patch("/topics/{topic_id}", response_model=TopicResponse)
async def api_topic_update(
    topic_id: uuid.UUID, payload: TopicUpdateRequest, session: SessionDep
):
    try:
        topic = topic_update(
            topic_id, TopicUpdate(**payload.model_dump(exclude_unset=True)), session
        )
    except ValueError as exc:
        raise NotFoundError(detail=str(exc))
    return TopicResponse(**topic.model_dump())


@router.delete("/topics/{topic_id}", response_model=TopicResponse)
async def api_topic_delete(topic_id: uuid.UUID, session: SessionDep):
    try:
        topic = topic_deactivate(topic_id, session)
    except ValueError as exc:
        raise NotFoundError(detail=str(exc))
    return TopicResponse(**topic.model_dump())


@router.get("/topics/{topic_id}/usage", response_model=UsageResponse)
async def api_topic_usage(topic_id: uuid.UUID, session: SessionDep):
    if not topic_get(topic_id, session):
        raise NotFoundError(detail=f"Topic not found: {topic_id}")
    return UsageResponse(count=topic_usage_count(topic_id, session))


# -- Subtopics ------------------------------------------------------------


@router.post("/subtopics", response_model=SubtopicResponse)
async def api_subtopic_create(payload: SubtopicCreateRequest, session: SessionDep):
    try:
        subtopic = subtopic_create(SubtopicCreate(**payload.model_dump()), session)
    except Exception as exc:
        session.rollback()
        # `uq_subtopic_topic_id_name` first: it is the more specific of the
        # two constraints, and a name collision reported as a `code` conflict
        # would send the client off to change the wrong field.
        if _integrity_error_is_duplicate(exc, constraint="subtopic.name"):
            raise ConflictError(
                detail=f"Subtopic name already exists for this topic: {payload.name}"
            )
        if _integrity_error_is_duplicate(exc):
            raise ConflictError(detail=f"Subtopic code already exists: {payload.code}")
        raise
    return SubtopicResponse(**subtopic.model_dump())


@router.get("/subtopics", response_model=list[SubtopicResponse])
async def api_subtopic_list(
    session: SessionDep,
    topic_id: uuid.UUID | None = None,
    include_inactive: bool = False,
):
    subtopics = subtopic_list(
        session, topic_id=topic_id, include_inactive=include_inactive
    )
    return [SubtopicResponse(**s.model_dump()) for s in subtopics]


@router.get("/subtopics/{subtopic_id}", response_model=SubtopicResponse)
async def api_subtopic_read(subtopic_id: uuid.UUID, session: SessionDep):
    subtopic = subtopic_get(subtopic_id, session)
    if not subtopic:
        raise NotFoundError(detail=f"Subtopic not found: {subtopic_id}")
    return SubtopicResponse(**subtopic.model_dump())


@router.patch("/subtopics/{subtopic_id}", response_model=SubtopicResponse)
async def api_subtopic_update(
    subtopic_id: uuid.UUID, payload: SubtopicUpdateRequest, session: SessionDep
):
    try:
        subtopic = subtopic_update(
            subtopic_id,
            SubtopicUpdate(**payload.model_dump(exclude_unset=True)),
            session,
        )
    except ValueError as exc:
        raise NotFoundError(detail=str(exc))
    return SubtopicResponse(**subtopic.model_dump())


@router.delete("/subtopics/{subtopic_id}", response_model=SubtopicResponse)
async def api_subtopic_delete(subtopic_id: uuid.UUID, session: SessionDep):
    try:
        subtopic = subtopic_deactivate(subtopic_id, session)
    except ValueError as exc:
        raise NotFoundError(detail=str(exc))
    return SubtopicResponse(**subtopic.model_dump())


@router.get("/subtopics/{subtopic_id}/usage", response_model=UsageResponse)
async def api_subtopic_usage(subtopic_id: uuid.UUID, session: SessionDep):
    if not subtopic_get(subtopic_id, session):
        raise NotFoundError(detail=f"Subtopic not found: {subtopic_id}")
    return UsageResponse(count=subtopic_usage_count(subtopic_id, session))


@router.post("/subtopics/{subtopic_id}/reassign", response_model=ReassignResponse)
async def api_subtopic_reassign(
    subtopic_id: uuid.UUID, payload: SubtopicReassignRequest, session: SessionDep
):
    try:
        reassigned = subtopic_reassign(subtopic_id, payload.target_subtopic_id, session)
    except ValueError as exc:
        raise NotFoundError(detail=str(exc))
    return ReassignResponse(reassigned=reassigned)


# -- Macro sectors ----------------------------------------------------------
# Fixed set of 4 (seeded once); no create/delete, only edit label/order or
# deactivate -- `code` governs behavior and is never exposed for editing.


@router.get("/macro_sectors", response_model=list[MacroSectorResponse])
async def api_macro_sector_list(session: SessionDep, include_inactive: bool = False):
    macro_sectors = macro_sector_list(session, include_inactive=include_inactive)
    return [MacroSectorResponse(**m.model_dump()) for m in macro_sectors]


@router.get("/macro_sectors/{macro_sector_id}", response_model=MacroSectorResponse)
async def api_macro_sector_read(macro_sector_id: uuid.UUID, session: SessionDep):
    macro_sector = macro_sector_get(macro_sector_id, session)
    if not macro_sector:
        raise NotFoundError(detail=f"MacroSector not found: {macro_sector_id}")
    return MacroSectorResponse(**macro_sector.model_dump())


@router.patch("/macro_sectors/{macro_sector_id}", response_model=MacroSectorResponse)
async def api_macro_sector_update(
    macro_sector_id: uuid.UUID, payload: MacroSectorUpdateRequest, session: SessionDep
):
    try:
        macro_sector = macro_sector_update(
            macro_sector_id,
            MacroSectorUpdate(**payload.model_dump(exclude_unset=True)),
            session,
        )
    except ValueError as exc:
        raise NotFoundError(detail=str(exc))
    return MacroSectorResponse(**macro_sector.model_dump())


@router.delete("/macro_sectors/{macro_sector_id}", response_model=MacroSectorResponse)
async def api_macro_sector_delete(macro_sector_id: uuid.UUID, session: SessionDep):
    try:
        macro_sector = macro_sector_deactivate(macro_sector_id, session)
    except ValueError as exc:
        raise NotFoundError(detail=str(exc))
    return MacroSectorResponse(**macro_sector.model_dump())
