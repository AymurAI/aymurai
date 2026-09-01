import uuid

from sqlmodel import Session, select

from aymurai.database.schema import (
    OrganigramUnit,
    OrganigramUnitCreate,
    OrganigramUnitUpdate,
)


def unit_create(unit_in: OrganigramUnitCreate, session: Session) -> OrganigramUnit:
    """
    Creates a new organigram unit record.

    Args:
        unit_in (OrganigramUnitCreate): Unit creation payload.
        session (Session): Database session.

    Returns:
        OrganigramUnit: The persisted unit record.
    """
    unit = OrganigramUnit(**unit_in.model_dump())
    session.add(unit)
    session.commit()
    session.refresh(unit)
    return unit


def unit_get(unit_id: uuid.UUID, session: Session) -> OrganigramUnit | None:
    """
    Reads a unit record by ID.

    Args:
        unit_id (uuid.UUID): Unit UUID.
        session (Session): Database session.

    Returns:
        OrganigramUnit | None: Unit record if found.
    """
    return session.get(OrganigramUnit, unit_id)


def unit_children(
    parent_id: uuid.UUID | None, session: Session, include_inactive: bool = False
) -> list[OrganigramUnit]:
    """
    Lists the direct children of a unit (or the roots, if `parent_id` is None),
    ordered by `order`.

    Args:
        parent_id (uuid.UUID | None): Parent unit UUID, or None for root units.
        session (Session): Database session.
        include_inactive (bool): Whether to include logically-deleted units.
            Defaults to False.

    Returns:
        list[OrganigramUnit]: Matching unit records.
    """
    statement = (
        select(OrganigramUnit)
        .where(OrganigramUnit.parent_id == parent_id)
        .order_by(OrganigramUnit.order)
    )
    if not include_inactive:
        statement = statement.where(OrganigramUnit.active == True)
    return list(session.exec(statement).all())


def unit_update(
    unit_id: uuid.UUID, unit_in: OrganigramUnitUpdate, session: Session
) -> OrganigramUnit:
    """
    Updates an existing unit record.

    Args:
        unit_id (uuid.UUID): Unit UUID to update.
        unit_in (OrganigramUnitUpdate): Update payload.
        session (Session): Database session.

    Raises:
        ValueError: If the unit does not exist.

    Returns:
        OrganigramUnit: The updated unit record.
    """
    unit = session.get(OrganigramUnit, unit_id)
    if not unit:
        raise ValueError(f"OrganigramUnit not found: {unit_id}")

    for field, value in unit_in.model_dump(exclude_unset=True).items():
        setattr(unit, field, value)

    session.add(unit)
    session.commit()
    session.refresh(unit)
    return unit


def ancestor_chain(unit: OrganigramUnit, session: Session) -> list[OrganigramUnit]:
    """
    Walks a unit's ancestors up to the root, root first.

    Args:
        unit (OrganigramUnit): Unit to walk up from (excluded from the result).
        session (Session): Database session.

    Returns:
        list[OrganigramUnit]: Ancestors, ordered root-to-parent.
    """
    chain: list[OrganigramUnit] = []
    current = unit
    while current.parent_id is not None:
        parent = session.get(OrganigramUnit, current.parent_id)
        if parent is None:
            break
        chain.append(parent)
        current = parent
    chain.reverse()
    return chain


def ruta_organigrama(unit: OrganigramUnit, session: Session) -> str:
    """
    Builds a unit's full path from the organigram root down to itself.

    Args:
        unit (OrganigramUnit): Unit to build the path for.
        session (Session): Database session.

    Returns:
        str: Ancestor names joined by " > ", ending with `unit.name`.
    """
    chain = [*ancestor_chain(unit, session), unit]
    return " > ".join(u.name for u in chain)


def unit_deactivate(unit_id: uuid.UUID, session: Session) -> OrganigramUnit:
    """
    Logically deletes a unit (sets `active=False`). Never a hard delete, so
    holder history and any resolved sector references are preserved.

    Args:
        unit_id (uuid.UUID): Unit UUID to deactivate.
        session (Session): Database session.

    Raises:
        ValueError: If the unit does not exist.

    Returns:
        OrganigramUnit: The deactivated unit record.
    """
    unit = session.get(OrganigramUnit, unit_id)
    if not unit:
        raise ValueError(f"OrganigramUnit not found: {unit_id}")

    unit.active = False
    session.add(unit)
    session.commit()
    session.refresh(unit)
    return unit
