import uuid

from sqlmodel import Session, select

from aymurai.database.schema import Topic, TopicCreate, TopicUpdate


def topic_create(topic_in: TopicCreate, session: Session) -> Topic:
    """
    Creates a new topic record.

    Args:
        topic_in (TopicCreate): Topic creation payload.
        session (Session): Database session.

    Returns:
        Topic: The persisted topic record.
    """
    topic = Topic(**topic_in.model_dump())
    session.add(topic)
    session.commit()
    session.refresh(topic)
    return topic


def topic_get(topic_id: uuid.UUID, session: Session) -> Topic | None:
    """
    Reads a topic record by ID.

    Args:
        topic_id (uuid.UUID): Topic UUID.
        session (Session): Database session.

    Returns:
        Topic | None: Topic record if found.
    """
    return session.get(Topic, topic_id)


def topic_list(session: Session, include_inactive: bool = False) -> list[Topic]:
    """
    Lists topics, ordered by `order`.

    Args:
        session (Session): Database session.
        include_inactive (bool): Whether to include logically-deleted topics.
            Defaults to False.

    Returns:
        list[Topic]: Matching topic records.
    """
    statement = select(Topic).order_by(Topic.order)
    if not include_inactive:
        statement = statement.where(Topic.active == True)
    return list(session.exec(statement).all())


def topic_update(topic_id: uuid.UUID, topic_in: TopicUpdate, session: Session) -> Topic:
    """
    Updates an existing topic record.

    Args:
        topic_id (uuid.UUID): Topic UUID to update.
        topic_in (TopicUpdate): Update payload.
        session (Session): Database session.

    Raises:
        ValueError: If the topic does not exist.

    Returns:
        Topic: The updated topic record.
    """
    topic = session.get(Topic, topic_id)
    if not topic:
        raise ValueError(f"Topic not found: {topic_id}")

    for field, value in topic_in.model_dump(exclude_unset=True).items():
        setattr(topic, field, value)

    session.add(topic)
    session.commit()
    session.refresh(topic)
    return topic


def topic_deactivate(topic_id: uuid.UUID, session: Session) -> Topic:
    """
    Logically deletes a topic (sets `active=False`). Never a hard delete, so
    existing references (subtopics, recommendations) are preserved.

    Args:
        topic_id (uuid.UUID): Topic UUID to deactivate.
        session (Session): Database session.

    Raises:
        ValueError: If the topic does not exist.

    Returns:
        Topic: The deactivated topic record.
    """
    topic = session.get(Topic, topic_id)
    if not topic:
        raise ValueError(f"Topic not found: {topic_id}")

    topic.active = False
    session.add(topic)
    session.commit()
    session.refresh(topic)
    return topic


def topic_usage_count(topic_id: uuid.UUID, session: Session) -> int:
    """
    Counts dataset records referencing this topic, shown before deactivation.

    The dataset table doesn't exist yet, so this is correctly always 0 until
    it does; the signature is already the one a real count will use.

    Args:
        topic_id (uuid.UUID): Topic UUID.
        session (Session): Database session.

    Returns:
        int: Number of dataset rows referencing this topic.
    """
    del topic_id, session
    return 0
