import uuid

from sqlmodel import Session, select

from aymurai.database.schema import OrganigramHolder


def holder_history(unit_id: uuid.UUID, session: Session) -> list[OrganigramHolder]:
    """
    Lists a unit's holder history, most recent first.

    Args:
        unit_id (uuid.UUID): Unit UUID.
        session (Session): Database session.

    Returns:
        list[OrganigramHolder]: Holder records for this unit, newest first.
    """
    statement = (
        select(OrganigramHolder)
        .where(OrganigramHolder.unit_id == unit_id)
        .order_by(OrganigramHolder.created_at.desc())
    )
    return list(session.exec(statement).all())


def holder_set_current(
    unit_id: uuid.UUID, name: str, session: Session
) -> OrganigramHolder:
    """
    Appoints a new current holder for a unit: marks any existing current
    holder as no longer current, then inserts a new holder row as current.
    Never updates the previous holder's row in place -- history accumulates.

    Args:
        unit_id (uuid.UUID): Unit UUID.
        name (str): New holder's name.
        session (Session): Database session.

    Returns:
        OrganigramHolder: The newly-current holder record.
    """
    previous = session.exec(
        select(OrganigramHolder)
        .where(OrganigramHolder.unit_id == unit_id)
        .where(OrganigramHolder.is_current == True)
    ).first()
    if previous:
        previous.is_current = False
        session.add(previous)
        session.flush()

    holder = OrganigramHolder(unit_id=unit_id, name=name, is_current=True)
    session.add(holder)
    session.commit()
    session.refresh(holder)
    return holder


def holder_update(
    holder_id: uuid.UUID, name: str, session: Session
) -> OrganigramHolder:
    """
    Corrects a holder's name in place, without touching `is_current`. A typo
    fixed in a past holder's name must never make that holder current again.

    Args:
        holder_id (uuid.UUID): Holder UUID to correct.
        name (str): Corrected name.
        session (Session): Database session.

    Raises:
        ValueError: If the holder does not exist.

    Returns:
        OrganigramHolder: The corrected holder record.
    """
    holder = session.get(OrganigramHolder, holder_id)
    if not holder:
        raise ValueError(f"OrganigramHolder not found: {holder_id}")

    holder.name = name
    session.add(holder)
    session.commit()
    session.refresh(holder)
    return holder
