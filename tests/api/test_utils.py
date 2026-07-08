import cachetools
import torch

from aymurai.api import utils
from aymurai.settings import settings


def test_pipeline_memory_cache_has_no_time_based_eviction():
    # Loaded pipelines are expensive and immutable per path; a TTL would
    # force reloading a still-active pipeline once the deadline passes.
    assert isinstance(utils.mem_cache, cachetools.LRUCache)
    assert utils.mem_cache.maxsize == settings.MEMORY_CACHE_MAXSIZE


def test_configure_torch_threads_calls_torch_api(monkeypatch):
    calls = []
    monkeypatch.setattr(settings, "TORCH_NUM_THREADS", 3)
    monkeypatch.setattr(torch, "set_num_threads", calls.append)

    utils.configure_torch_threads()

    assert calls == [3]
