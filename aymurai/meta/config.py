from typing import Any, TypedDict

from aymurai.meta.pipeline_interfaces import TrainModule, Transform

PipeSchema = tuple[str | Transform, dict[str, Any]]
ModelSchema = tuple[str | TrainModule, dict[str, Any]]


class ConfigSchema(TypedDict):
    preprocess: list[PipeSchema]
    models: list[ModelSchema]
    postprocess: list[PipeSchema]
    multiprocessing: dict | None


EMPTY_CONFIG = ConfigSchema(preprocess=[], models=[], postprocess=[])
