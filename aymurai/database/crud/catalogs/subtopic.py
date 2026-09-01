import uuid

from sqlmodel import Session, select

from aymurai.database.schema import Subtopic, SubtopicCreate, SubtopicUpdate, Topic


def subtopic_create(subtopic_in: SubtopicCreate, session: Session) -> Subtopic:
    """
    Creates a new subtopic record.

    Args:
        subtopic_in (SubtopicCreate): Subtopic creation payload.
        session (Session): Database session.

    Returns:
        Subtopic: The persisted subtopic record.
    """
    subtopic = Subtopic(**subtopic_in.model_dump())
    session.add(subtopic)
    session.commit()
    session.refresh(subtopic)
    return subtopic


def subtopic_get(subtopic_id: uuid.UUID, session: Session) -> Subtopic | None:
    """
    Reads a subtopic record by ID.

    Args:
        subtopic_id (uuid.UUID): Subtopic UUID.
        session (Session): Database session.

    Returns:
        Subtopic | None: Subtopic record if found.
    """
    return session.get(Subtopic, subtopic_id)


def subtopic_list(
    session: Session,
    topic_id: uuid.UUID | None = None,
    include_inactive: bool = False,
) -> list[Subtopic]:
    """
    Lists subtopics, ordered by `order`.

    Deactivating a topic hides its subtopics too: by default a subtopic whose
    parent topic is inactive is excluded, even if the subtopic itself is
    `active=True`.

    Args:
        session (Session): Database session.
        topic_id (uuid.UUID | None): If given, restrict to this topic's subtopics.
        include_inactive (bool): Whether to include logically-deleted subtopics
            and subtopics of inactive topics. Defaults to False.

    Returns:
        list[Subtopic]: Matching subtopic records.
    """
    statement = select(Subtopic).order_by(Subtopic.order)
    if topic_id is not None:
        statement = statement.where(Subtopic.topic_id == topic_id)
    if not include_inactive:
        statement = (
            statement.join(Topic, Topic.id == Subtopic.topic_id)
            .where(Subtopic.active)
            .where(Topic.active)
        )
    return list(session.exec(statement).all())


def subtopic_update(
    subtopic_id: uuid.UUID, subtopic_in: SubtopicUpdate, session: Session
) -> Subtopic:
    """
    Updates an existing subtopic record.

    Args:
        subtopic_id (uuid.UUID): Subtopic UUID to update.
        subtopic_in (SubtopicUpdate): Update payload.
        session (Session): Database session.

    Raises:
        ValueError: If the subtopic does not exist.

    Returns:
        Subtopic: The updated subtopic record.
    """
    subtopic = session.get(Subtopic, subtopic_id)
    if not subtopic:
        raise ValueError(f"Subtopic not found: {subtopic_id}")

    for field, value in subtopic_in.model_dump(exclude_unset=True).items():
        setattr(subtopic, field, value)

    session.add(subtopic)
    session.commit()
    session.refresh(subtopic)
    return subtopic


def subtopic_deactivate(subtopic_id: uuid.UUID, session: Session) -> Subtopic:
    """
    Logically deletes a subtopic (sets `active=False`). Never a hard delete.

    Args:
        subtopic_id (uuid.UUID): Subtopic UUID to deactivate.
        session (Session): Database session.

    Raises:
        ValueError: If the subtopic does not exist.

    Returns:
        Subtopic: The deactivated subtopic record.
    """
    subtopic = session.get(Subtopic, subtopic_id)
    if not subtopic:
        raise ValueError(f"Subtopic not found: {subtopic_id}")

    subtopic.active = False
    session.add(subtopic)
    session.commit()
    session.refresh(subtopic)
    return subtopic


def subtopic_usage_count(subtopic_id: uuid.UUID, session: Session) -> int:
    """
    Counts dataset records referencing this subtopic. See `topic_usage_count`
    for why this is always 0 for now.

    Args:
        subtopic_id (uuid.UUID): Subtopic UUID.
        session (Session): Database session.

    Returns:
        int: Number of dataset rows referencing this subtopic.
    """
    del subtopic_id, session
    return 0


def subtopic_reassign(
    subtopic_id: uuid.UUID, target_subtopic_id: uuid.UUID, session: Session
) -> int:
    """
    Bulk-reassigns dataset records from one subtopic to another, ahead of
    deactivating the source subtopic.

    The dataset table doesn't exist yet, so there's nothing to reassign today
    and this always returns 0; the signature is already the one a real bulk
    update will use.

    Args:
        subtopic_id (uuid.UUID): Subtopic being emptied out.
        target_subtopic_id (uuid.UUID): Subtopic to reassign records to.
        session (Session): Database session.

    Raises:
        ValueError: If either subtopic does not exist.

    Returns:
        int: Number of records reassigned.
    """
    if not session.get(Subtopic, subtopic_id):
        raise ValueError(f"Subtopic not found: {subtopic_id}")
    if not session.get(Subtopic, target_subtopic_id):
        raise ValueError(f"Subtopic not found: {target_subtopic_id}")

    return 0
