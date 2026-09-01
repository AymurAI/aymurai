from sqlmodel import Session, select

from aymurai.database.schema import Dataset

DEFAULT_DATASET_CODE = "defensoria-recommendations"


def get_or_create_default_dataset(session: Session) -> Dataset:
    """
    Gets the single shared dataset every recommendation belongs to, creating
    it on first use. There's no ownership column because there's no owner --
    the dataset belongs to the instance, every connected client sees it whole.

    Args:
        session (Session): Database session.

    Returns:
        Dataset: The shared dataset record.
    """
    dataset = session.exec(
        select(Dataset).where(Dataset.code == DEFAULT_DATASET_CODE)
    ).first()
    if dataset:
        return dataset

    dataset = Dataset(code=DEFAULT_DATASET_CODE, name="Recomendaciones Defensoría")
    session.add(dataset)
    session.commit()
    session.refresh(dataset)
    return dataset
