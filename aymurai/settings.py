import json
import os
from copy import deepcopy
from pathlib import Path

from dotenv import load_dotenv
from pydantic import AliasChoices, ConfigDict, Field, FilePath, field_validator
from pydantic_settings import BaseSettings

import aymurai
from aymurai.utils.yaml_data import load_yaml

PARENT = Path(aymurai.__file__).parent


DEFAULT_DISAMBIGUATION_LABEL_POLICIES = load_yaml(
    str(PARENT / "config" / "default_disambiguation_label_policies.yml")
)

DEFAULT_RENDER_POLICY = {"suffix_mode": "auto", "suffix_threshold": 1}


def load_env():
    load_dotenv(".env")

    # Load the stage-specific .env file (if it exists)
    stage = os.getenv("STAGE")
    if stage:
        env_file = f".env.{stage}"
        if os.path.exists(env_file):
            load_dotenv(env_file)


class Settings(BaseSettings):
    model_config = ConfigDict(case_sensitive=False)

    CORS_ORIGINS: list[str] | str = ",".join(
        [
            "http://localhost",
            "https://localhost",
            "http://localhost:8080",
            "http://localhost:3000",
            "0.0.0.0:8899",
            "0.0.0.0:3000",
        ]
    )

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v) -> list[str]:
        if v is None:
            return []

        if not isinstance(v, str):
            raise ValueError(v)

        return [i.strip() for i in v.split(",")]

    SQLALCHEMY_DATABASE_URI: str = "sqlite:////resources/cache/sqlite/database.db"

    RESOURCES_BASEPATH: str = "/resources"
    CACHE_BASEPATH: str = Field(
        default="/resources/cache",
        validation_alias=AliasChoices("AYMURAI_CACHE_BASEPATH", "CACHE_BASEPATH"),
    )

    # Alembic Config for running migrations
    ALEMBIC_INI_PATH: FilePath = PARENT / "alembic.ini"

    # API server bind address (used by the `aymurai-api` console entrypoint)
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8899

    ENV: str | None = None

    # In-memory pipeline cache (see aymurai.api.utils.mem_cache). There are
    # only 2 production pipelines (datapublic, flair-anonymizer) today; 4
    # gives headroom for near-term growth (e.g. per-model-manager instances)
    # without ever evicting either under normal traffic.
    MEMORY_CACHE_MAXSIZE: int = 4
    TORCH_NUM_THREADS: int = 4

    LIBREOFFICE_BIN: str = "libreoffice"
    PDF_WATERMARK_FONT_REGULAR: str | None = None
    PDF_WATERMARK_FONT_BOLD: str | None = None
    ANONYMIZATION_METADATA_CREATOR: str = "AymurAI"
    ANONYMIZATION_METADATA_PRODUCER: str = "AymurAI"

    # Disambiguation Config

    # Fuzzy Matching
    THRESHOLD: int = 70

    # Label policies (JSON dict: label -> {disambiguation, anonymize})
    DISAMBIGUATION_LABEL_POLICIES: dict | None = Field(
        default_factory=lambda: deepcopy(DEFAULT_DISAMBIGUATION_LABEL_POLICIES)
    )

    # Render policy (JSON dict)
    RENDER_POLICY: dict | None = Field(
        default_factory=lambda: deepcopy(DEFAULT_RENDER_POLICY)
    )

    @field_validator("DISAMBIGUATION_LABEL_POLICIES", "RENDER_POLICY", mode="before")
    @classmethod
    def parse_policies(cls, v):
        if v is None or v == "":
            return None
        if isinstance(v, str):
            return json.loads(v)
        return v

    FRONTEND_DIST_DIR: str = Field(
        default="frontend-dist",
        validation_alias=AliasChoices("AYMURAI_FRONTEND_DIST_DIR", "FRONTEND_DIST_DIR"),
    )

    # ASR Config (coro — OpenAI-compatible server)
    TRANSCRIBE_BASE_URL: str | None = None
    TRANSCRIBE_API_KEY: str = "not-needed"

    # LLM generation defaults (consumed by /llm/summarize)
    LLM_DEFAULT_MAX_TOKENS: int = 4096
    LLM_CHUNK_OVERLAP_TOKENS: int = 128
    # Optional cap on the server's own context window. None = use the server's
    # n_ctx as-is; the request cannot raise it, since llama-server fixes the
    # window at launch (-c).
    LLM_MAX_CONTEXT_TOKENS: int | None = None

    # llama.cpp Config (llama-server — OpenAI-compatible server)
    LLAMACPP_BASE_URL: str | None = None
    LLAMACPP_API_KEY: str = "not-needed"


load_env()
settings = Settings()
