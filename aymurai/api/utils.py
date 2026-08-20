import cachetools
import torch

from aymurai.logger import get_logger
from aymurai.pipeline import AymurAIPipeline
from aymurai.settings import settings

logger = get_logger(__name__)


# Loaded pipelines are expensive (Flair NER, sentence-transformers, etc.) and
# immutable for a given path, so this never expires entries by time — a
# TTLCache with a low TTL would force a full model reload on every request
# past the deadline, even for a pipeline still being hit constantly.
mem_cache = cachetools.LRUCache(maxsize=settings.MEMORY_CACHE_MAXSIZE)

RESOURCES_BASEPATH = settings.RESOURCES_BASEPATH


@cachetools.cached(cache=mem_cache)
def load_pipeline(path: str):
    return AymurAIPipeline.load(path)


def configure_torch_threads() -> None:
    torch.set_num_threads(settings.TORCH_NUM_THREADS)
