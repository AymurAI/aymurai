from sqlalchemy import func, or_
from sqlmodel import Session, select

from aymurai.database.schema import OrganigramUnit, Recipient


def recipient_learned_index_lookup(
    normalized_name: str | None,
    normalized_position: str | None,
    session: Session,
) -> Recipient | None:
    """
    Looks up the most recently confirmed recipient matching this name or
    position -- every `recipient` row is, by construction, human-reviewed
    (a `recommendation` only exists after validation), so there's no separate
    "confirmed" flag to check.

    Args:
        normalized_name (str | None): Normalized recipient name to match.
        normalized_position (str | None): Normalized recipient position to match.
        session (Session): Database session.

    Returns:
        Recipient | None: The most recent match whose `unit_id` is still an
            active organigram unit, or None if neither field is given, or
            nothing matches, or the only match's unit was since deactivated
            (a stale confirmation must not keep getting reused as ground
            truth once the organigram itself has moved on).
    """
    if not normalized_name and not normalized_position:
        return None

    conditions = []
    if normalized_name:
        conditions.append(Recipient.normalized_name == normalized_name)
    if normalized_position:
        conditions.append(Recipient.normalized_position == normalized_position)

    statement = (
        select(Recipient)
        .join(OrganigramUnit, OrganigramUnit.id == Recipient.unit_id)
        .where(Recipient.unit_id.is_not(None))
        .where(OrganigramUnit.active)
        .where(or_(*conditions))
        .order_by(func.coalesce(Recipient.updated_at, Recipient.created_at).desc())
    )
    return session.exec(statement).first()
