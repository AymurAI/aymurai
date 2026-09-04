import uuid
from datetime import date

from sqlmodel import Session, col, select

from aymurai.database.schema import OrganigramHolder


def holder_history(unit_id: uuid.UUID, session: Session) -> list[OrganigramHolder]:
    """
    Lists a unit's holder history, most recent term first.

    Ordered by `start_date`, not `created_at`: a history entered after the
    fact is written in whatever order the user happened to type it, so insert
    order says nothing about who succeeded whom. `created_at` breaks ties and
    carries rows whose term date is unknown.

    Args:
        unit_id (uuid.UUID): Unit UUID.
        session (Session): Database session.

    Returns:
        list[OrganigramHolder]: Holder records for this unit, newest first.
    """
    statement = (
        select(OrganigramHolder)
        .where(OrganigramHolder.unit_id == unit_id)
        .order_by(
            col(OrganigramHolder.start_date).desc(),
            col(OrganigramHolder.created_at).desc(),
        )
    )
    return list(session.exec(statement).all())


def holder_set_current(
    unit_id: uuid.UUID,
    name: str,
    session: Session,
    start_date: date | None = None,
) -> OrganigramHolder:
    """
    Appoints a new current holder for a unit: marks any existing current
    holder as no longer current, then inserts a new holder row as current.
    Never updates the previous holder's row in place -- history accumulates.

    Args:
        unit_id (uuid.UUID): Unit UUID.
        name (str): New holder's name.
        session (Session): Database session.
        start_date (date | None): When this person took office. Defaults to
            today, which is right for "someone takes over now"; a term that
            began earlier is passed in, or corrected later via `holder_update`.

    Returns:
        OrganigramHolder: The newly-current holder record.
    """
    previous = session.exec(
        select(OrganigramHolder)
        .where(OrganigramHolder.unit_id == unit_id)
        .where(OrganigramHolder.is_current)
    ).first()
    if previous:
        previous.is_current = False
        session.add(previous)
        session.flush()

    holder = OrganigramHolder(
        unit_id=unit_id,
        name=name,
        is_current=True,
        start_date=start_date if start_date is not None else date.today(),
    )
    session.add(holder)
    session.commit()
    session.refresh(holder)
    return holder


def holder_update(
    holder_id: uuid.UUID,
    session: Session,
    name: str | None = None,
    start_date: date | None = None,
) -> OrganigramHolder:
    """
    Corrects a holder's record in place, without touching `is_current`. A typo
    fixed in a past holder's name must never make that holder current again,
    and neither must a corrected term date.

    Both fields are optional and only applied when given, so a date-only
    correction leaves the name alone and vice versa.

    Args:
        holder_id (uuid.UUID): Holder UUID to correct.
        session (Session): Database session.
        name (str | None): Corrected name, when it is being corrected.
        start_date (date | None): Corrected term start, when it is being
            corrected.

    Raises:
        ValueError: If the holder does not exist.

    Returns:
        OrganigramHolder: The corrected holder record.
    """
    holder = session.get(OrganigramHolder, holder_id)
    if not holder:
        raise ValueError(f"OrganigramHolder not found: {holder_id}")

    if name is not None:
        holder.name = name
    if start_date is not None:
        holder.start_date = start_date
    session.add(holder)
    session.commit()
    session.refresh(holder)
    return holder
