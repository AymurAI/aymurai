from aymurai.database.schema import OrganigramUnit


def resolve_sector(unit: OrganigramUnit, session) -> OrganigramUnit | None:
    """
    Resolves a unit's sector: the deepest ancestor-or-self that is an ACTIVE
    `is_sector` unit.

    A deactivated sector is walked past as if it weren't a sector, so
    suggestions never propose one -- matching every other organigram query,
    all of which filter on `active`. Validation must NOT use this to compare
    against a stored pair (a sector deactivated after a human confirmed it
    would suddenly stop matching, and the pair this function now proposes is
    not always the nearest one); use `is_sector_ancestor_of` for that.

    Args:
        unit (OrganigramUnit): Unit to resolve the sector for.
        session: Database session, used to walk up `parent_id`.

    Returns:
        OrganigramUnit | None: The sector unit, or None if no ancestor-or-self
            is an active sector (e.g. the tree root, which sits above every
            sector and isn't one itself).
    """
    current: OrganigramUnit | None = unit
    while current is not None:
        if current.is_sector and current.active:
            return current
        if current.parent_id is None:
            return None
        current = session.get(OrganigramUnit, current.parent_id)
    return None


def is_sector_ancestor_of(
    sector: OrganigramUnit, unit: OrganigramUnit, session
) -> bool:
    """
    Checks whether `sector` is an `is_sector` ancestor-or-self of `unit`.

    This is the validation counterpart to `resolve_sector`: it asks whether a
    human-submitted `(unit_id, sector_id)` pair is *consistent*, not whether
    `sector_id` is the one the system would have picked. Membership rather
    than identity, for two reasons:

    - `resolve_sector` skips deactivated sectors, so the pair it proposes may
      name a sector that is NOT the nearest one; that pair must still save.
    - a sector deactivated after a human confirmed it must not retroactively
      invalidate the row they already validated.

    `active` is deliberately not checked here for the same reason.

    Args:
        sector (OrganigramUnit): The submitted sector.
        unit (OrganigramUnit): The submitted unit.
        session: Database session, used to walk up `parent_id`.

    Returns:
        bool: True when the pair is consistent with the organigram.
    """
    if not sector.is_sector:
        return False

    current: OrganigramUnit | None = unit
    while current is not None:
        if current.id == sector.id:
            return True
        if current.parent_id is None:
            return False
        current = session.get(OrganigramUnit, current.parent_id)
    return False
