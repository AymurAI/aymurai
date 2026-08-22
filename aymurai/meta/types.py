from typing import Any

from typing_extensions import TypedDict


class Annotation(TypedDict):
    label: str
    value: Any


class DataItem(TypedDict):
    path: str
    extension: str
    dataset: str
    data: dict | None
    annotations: list[Annotation] | None
    predictions: list[Annotation] | None


DataBlock = list[DataItem]
PredictionBlock = list[Annotation]
