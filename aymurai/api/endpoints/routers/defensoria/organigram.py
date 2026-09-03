import uuid
from typing import Annotated

from fastapi import Depends
from fastapi.routing import APIRouter
from sqlmodel import Session

from aymurai.api.exceptions import NotFoundError
from aymurai.api.endpoints.schemas.requests.organigram import (
    OrganigramHolderCreateRequest,
    OrganigramHolderUpdateRequest,
    OrganigramUnitCreateRequest,
    OrganigramUnitUpdateRequest,
)
from aymurai.api.endpoints.schemas.responses.organigram import (
    OrganigramHolderResponse,
    OrganigramUnitResponse,
)
from aymurai.database.crud.organigram.holder import (
    holder_history,
    holder_set_current,
    holder_update,
)
from aymurai.database.crud.organigram.unit import (
    unit_children,
    unit_create,
    unit_deactivate,
    unit_get,
    unit_update,
)
from aymurai.database.schema import OrganigramUnitCreate, OrganigramUnitUpdate
from aymurai.database.session import get_session

router = APIRouter()

SessionDep = Annotated[Session, Depends(get_session)]


# -- Units --------------------------------------------------------------


@router.post("/units", response_model=OrganigramUnitResponse)
async def api_unit_create(payload: OrganigramUnitCreateRequest, session: SessionDep):
    unit = unit_create(OrganigramUnitCreate(**payload.model_dump()), session)
    return OrganigramUnitResponse(**unit.model_dump())


@router.get("/units", response_model=list[OrganigramUnitResponse])
async def api_unit_list(
    session: SessionDep,
    parent_id: uuid.UUID | None = None,
    include_inactive: bool = False,
):
    units = unit_children(parent_id, session, include_inactive=include_inactive)
    return [OrganigramUnitResponse(**u.model_dump()) for u in units]


@router.get("/units/{unit_id}", response_model=OrganigramUnitResponse)
async def api_unit_read(unit_id: uuid.UUID, session: SessionDep):
    unit = unit_get(unit_id, session)
    if not unit:
        raise NotFoundError(detail=f"OrganigramUnit not found: {unit_id}")
    return OrganigramUnitResponse(**unit.model_dump())


@router.patch("/units/{unit_id}", response_model=OrganigramUnitResponse)
async def api_unit_update(
    unit_id: uuid.UUID, payload: OrganigramUnitUpdateRequest, session: SessionDep
):
    try:
        unit = unit_update(
            unit_id,
            OrganigramUnitUpdate(**payload.model_dump(exclude_unset=True)),
            session,
        )
    except ValueError as exc:
        raise NotFoundError(detail=str(exc))
    return OrganigramUnitResponse(**unit.model_dump())


@router.delete("/units/{unit_id}", response_model=OrganigramUnitResponse)
async def api_unit_delete(unit_id: uuid.UUID, session: SessionDep):
    try:
        unit = unit_deactivate(unit_id, session)
    except ValueError as exc:
        raise NotFoundError(detail=str(exc))
    return OrganigramUnitResponse(**unit.model_dump())


# -- Holders --------------------------------------------------------------


@router.get("/units/{unit_id}/holders", response_model=list[OrganigramHolderResponse])
async def api_unit_holders(unit_id: uuid.UUID, session: SessionDep):
    if not unit_get(unit_id, session):
        raise NotFoundError(detail=f"OrganigramUnit not found: {unit_id}")
    holders = holder_history(unit_id, session)
    return [OrganigramHolderResponse(**h.model_dump()) for h in holders]


@router.post("/units/{unit_id}/holders", response_model=OrganigramHolderResponse)
async def api_unit_holder_create(
    unit_id: uuid.UUID, payload: OrganigramHolderCreateRequest, session: SessionDep
):
    if not unit_get(unit_id, session):
        raise NotFoundError(detail=f"OrganigramUnit not found: {unit_id}")
    holder = holder_set_current(unit_id, payload.name, session)
    return OrganigramHolderResponse(**holder.model_dump())


@router.patch("/holders/{holder_id}", response_model=OrganigramHolderResponse)
async def api_holder_update(
    holder_id: uuid.UUID, payload: OrganigramHolderUpdateRequest, session: SessionDep
):
    try:
        holder = holder_update(holder_id, payload.name, session)
    except ValueError as exc:
        raise NotFoundError(detail=str(exc))
    return OrganigramHolderResponse(**holder.model_dump())
