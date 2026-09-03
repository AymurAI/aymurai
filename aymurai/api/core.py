from fastapi.routing import APIRouter

from aymurai.settings import settings

from .endpoints.routers.anonymizer import anonymizer
from .endpoints.routers.asr import transcribe
from .endpoints.routers.datapublic import datapublic
from .endpoints.routers.defensoria import catalogs, data_extraction, organigram
from .endpoints.routers.llm import summarization, summary_validation
from .endpoints.routers.misc import convert, document_extract
from .endpoints.routers.server import stats

router = APIRouter()


# Server
router.include_router(
    stats.router,
    prefix="/server/stats",
    tags=["server"],
)

# Anonymizer
router.include_router(
    anonymizer.router,
    prefix="/anonymizer",
    tags=["anonymization/model"],
)

# Datapublic
router.include_router(
    datapublic.router,
    prefix="/datapublic",
    tags=["datapublic/model"],
)

# LLM
router.include_router(
    summarization.router,
    prefix="/llm",
    tags=["llm/summarization"],
)
router.include_router(
    summary_validation.router,
    prefix="/llm",
    tags=["llm/summarization"],
)

# ASR
router.include_router(
    transcribe.router,
    prefix="/asr",
    tags=["asr"],
)


# Misc
router.include_router(document_extract.router, tags=["document"], deprecated=True)
router.include_router(document_extract.router, prefix="/misc", tags=["document"])

# Document conversion
router.include_router(convert.router, tags=["Document conversion"])

# Defensoría del Pueblo (CABA) -- tables/migrations always run, only router
# registration is gated by this flag.
if settings.DEFENSORIA_ENABLED:
    router.include_router(
        catalogs.router,
        prefix="/catalogs",
        tags=["defensoria/catalogs"],
    )
    router.include_router(
        organigram.router,
        prefix="/organigram",
        tags=["defensoria/organigram"],
    )
    router.include_router(
        data_extraction.router,
        prefix="/llm",
        tags=["defensoria/llm"],
    )
