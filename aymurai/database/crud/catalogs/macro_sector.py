import uuid

from sqlmodel import Session, select

from aymurai.database.schema import MacroSector, MacroSectorCreate, MacroSectorUpdate


def macro_sector_create(
    macro_sector_in: MacroSectorCreate, session: Session
) -> MacroSector:
    """
    Creates a new macro sector record.

    Args:
        macro_sector_in (MacroSectorCreate): Macro sector creation payload.
        session (Session): Database session.

    Returns:
        MacroSector: The persisted macro sector record.
    """
    macro_sector = MacroSector(**macro_sector_in.model_dump())
    session.add(macro_sector)
    session.commit()
    session.refresh(macro_sector)
    return macro_sector


def macro_sector_get(
    macro_sector_id: uuid.UUID, session: Session
) -> MacroSector | None:
    """
    Reads a macro sector record by ID.

    Args:
        macro_sector_id (uuid.UUID): Macro sector UUID.
        session (Session): Database session.

    Returns:
        MacroSector | None: Macro sector record if found.
    """
    return session.get(MacroSector, macro_sector_id)


def macro_sector_list(
    session: Session, include_inactive: bool = False
) -> list[MacroSector]:
    """
    Lists macro sectors, ordered by `order`.

    Args:
        session (Session): Database session.
        include_inactive (bool): Whether to include logically-deleted macro
            sectors. Defaults to False.

    Returns:
        list[MacroSector]: Matching macro sector records.
    """
    statement = select(MacroSector).order_by(MacroSector.order)
    if not include_inactive:
        statement = statement.where(MacroSector.active == True)
    return list(session.exec(statement).all())


def macro_sector_update(
    macro_sector_id: uuid.UUID, macro_sector_in: MacroSectorUpdate, session: Session
) -> MacroSector:
    """
    Updates an existing macro sector record. `code` is never editable here --
    it governs behavior (only "GCBA" triggers the organigram cross-check) and
    must stay stable; only the display `name` and bookkeeping fields change.

    Args:
        macro_sector_id (uuid.UUID): Macro sector UUID to update.
        macro_sector_in (MacroSectorUpdate): Update payload.
        session (Session): Database session.

    Raises:
        ValueError: If the macro sector does not exist.

    Returns:
        MacroSector: The updated macro sector record.
    """
    macro_sector = session.get(MacroSector, macro_sector_id)
    if not macro_sector:
        raise ValueError(f"MacroSector not found: {macro_sector_id}")

    for field, value in macro_sector_in.model_dump(exclude_unset=True).items():
        setattr(macro_sector, field, value)

    session.add(macro_sector)
    session.commit()
    session.refresh(macro_sector)
    return macro_sector


def macro_sector_deactivate(
    macro_sector_id: uuid.UUID, session: Session
) -> MacroSector:
    """
    Logically deletes a macro sector (sets `active=False`). Never a hard delete.

    Args:
        macro_sector_id (uuid.UUID): Macro sector UUID to deactivate.
        session (Session): Database session.

    Raises:
        ValueError: If the macro sector does not exist.

    Returns:
        MacroSector: The deactivated macro sector record.
    """
    macro_sector = session.get(MacroSector, macro_sector_id)
    if not macro_sector:
        raise ValueError(f"MacroSector not found: {macro_sector_id}")

    macro_sector.active = False
    session.add(macro_sector)
    session.commit()
    session.refresh(macro_sector)
    return macro_sector
