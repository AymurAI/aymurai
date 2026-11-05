import locale

from aymurai.logger import get_logger

logger = get_logger(__name__)

# Set locale to es_AR to handle Spanish month names in %B patterns below.
# Deployment images provision this locale explicitly (see docker/api/Dockerfile
# and .github/workflows/pytest.yml), but not every machine that imports this
# module has it (e.g. macOS can't install arbitrary locales at all) -- without
# this guard, the import itself would crash there. When it's missing, prose
# date/month patterns just won't match (callers already treat "no match" as a
# normal outcome); numeric patterns are locale-independent and keep working.
try:
    locale.setlocale(locale.LC_ALL, "es_AR.UTF-8")
except locale.Error:
    logger.warning(
        "es_AR.UTF-8 locale not available -- Spanish month-name date patterns "
        "won't match on this machine"
    )

DATES = [
    r"%-d/%-m/%Y",
    r"%-d/%-m/%y",
    r"%d/%m/%Y",
    r"%d/%m/%y",
    r"(?i)%-d de %B del? %Y",
    r"(?i)%-d de %B %Y",
    r"(?i)%-d %B de %Y",
    r"(?i)%-d de %B %Y",
    r"%d-%m-%Y",
    r"%Y-%m-%d",
    r"(?i)%-d de %B",
]

HOURS = [
    r"%H[\.:]%M",
    r"(?i)%-H[\.:]%M horas",
    r"(?i)%-H.%M h(rs|r|s)\.?",
]

patterns = {
    "FECHA_RESOLUCION": DATES,
    "FECHA": DATES,
    "HORA_DE_INICIO": HOURS,
    "HORA_DE_CIERRE": HOURS,
}
