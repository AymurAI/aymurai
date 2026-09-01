from aymurai.database.schema import OrganigramUnit


def resolve_sector(unit: OrganigramUnit, session) -> OrganigramUnit | None:
    """
    Resolves a unit's sector: the deepest ancestor-or-self with `is_sector=True`.

    Args:
        unit (OrganigramUnit): Unit to resolve the sector for.
        session: Database session, used to walk up `parent_id`.

    Returns:
        OrganigramUnit | None: The sector unit, or None if no ancestor-or-self
            is marked as a sector (e.g. the tree root, which sits above every
            sector and isn't one itself).
    """
    current: OrganigramUnit | None = unit
    while current is not None:
        if current.is_sector:
            return current
        if current.parent_id is None:
            return None
        current = session.get(OrganigramUnit, current.parent_id)
    return None
