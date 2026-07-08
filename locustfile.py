"""Load-test scenario for the AymurAI API.

Ported from the legacy AymurAI/backend repo (locustfile.py on the `dev`
branch) and adapted to this monorepo's current routes, all mounted under
`/api`. Kept in the repo (not thrown away after one-off validation) because
it's the tool used to empirically validate runtime/concurrency fixes —
originally to confirm the pipeline in-memory cache eviction bug (see
aymurai/api/utils.py) and its fix, and reusable for future work (threadpool
offloading, batch processing, LLM/ASR external-service load).

Usage:
    make stress-test
    # or directly:
    uv run --group loadtest locust -f locustfile.py --host http://localhost:8899

Runs DataPublicUser and AnonymizerUser concurrently by default, which is the
scenario that matters most: interleaved traffic across both production
pipelines at once, since that's what exposes per-pipeline cache eviction and
cross-pipeline blocking that a single-endpoint test would miss.
"""

import uuid

import lorem
from locust import HttpUser, task, between

from aymurai.logger import get_logger

logger = get_logger(__name__)


class ServerStats:
    def __init__(self):
        self.n_cores: int = 0
        self.cpu_usage = 0

        self.memory_limit = 0
        self.memory_usage = 0

    @property
    def memory_percent(self):
        return self.memory_usage / self.memory_limit * 100 if self.memory_limit else 0

    def update_metrics(self, n_cores, cpu_percent, memory_limit, memory_percent):
        self.n_cores = n_cores
        self.cpu_usage = cpu_percent

        self.memory_limit = memory_limit
        self.memory_usage = memory_percent


stats = ServerStats()


def generate_text():
    # lorem 0.1.1's public API is `paragraph()`/`sentence()`/`text()` with no
    # keyword arguments (see lorem/__init__.py and lorem/text.py) — there is
    # no `get_paragraph`.
    paragraph = lorem.paragraph()

    # Unique per call so `use_cache` lookups always miss and every request
    # actually exercises the pipeline (preprocess/predict/postprocess), not
    # just a cache hit.
    return f"{str(uuid.uuid4())} {paragraph}"


class StatsMixin:
    """Shared /server/stats/summary polling used by both user types."""

    def fetch_server_stats(self):
        try:
            response = self.client.get("/api/server/stats/summary")

            if response.status_code != 200:
                logger.error("Error fetching server stats.")
                return

            data = response.json()

            stats.update_metrics(
                n_cores=data.get("cpu_core_limit", 0),
                cpu_percent=data.get("cpu_usage_percent", 0),
                memory_limit=data.get("memory_limit_mb", 0),
                memory_percent=data.get("memory_usage_mb", 0),
            )

        except Exception as e:
            print(f"Error fetching server stats: {e}")


class DataPublicUser(StatsMixin, HttpUser):
    wait_time = between(1, 2)

    def on_start(self):
        # One simulated "document" per user, matching real usage: a user
        # submits a document and predicts over several of its paragraphs.
        self.document_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, str(uuid.uuid4())))
        self.fetch_server_stats()

    @task
    def predict_datapublic(self):
        payload = {"text": generate_text()}
        with self.client.post(
            f"/api/datapublic/predict/{self.document_id}",
            json=payload,
            params={"use_cache": "false"},
            catch_response=True,
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Failed with status code: {response.status_code}")

        self.fetch_server_stats()

        print(
            "Request: predict (datapublic),"
            f" Response Time: {response.elapsed.total_seconds() * 1000}ms,"
            f" CPU Usage: {stats.cpu_usage}% ({stats.n_cores} cores),"  # noqa: E501
            f" Memory Usage: {stats.memory_usage} / {stats.memory_limit}MB ({stats.memory_percent}%)",  # noqa: E501
        )


class AnonymizerUser(StatsMixin, HttpUser):
    wait_time = between(1, 2)

    def on_start(self):
        self.fetch_server_stats()

    @task
    def predict_anonymizer(self):
        payload = {"text": generate_text()}
        with self.client.post(
            "/api/anonymizer/predict",
            json=payload,
            params={"use_cache": "false"},
            catch_response=True,
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Failed with status code: {response.status_code}")

        self.fetch_server_stats()

        print(
            "Request: predict (anonymizer),"
            f" Response Time: {response.elapsed.total_seconds() * 1000}ms,"
            f" CPU Usage: {stats.cpu_usage}% ({stats.n_cores} cores),"  # noqa: E501
            f" Memory Usage: {stats.memory_usage} / {stats.memory_limit}MB ({stats.memory_percent}%)",  # noqa: E501
        )
