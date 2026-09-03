from pathlib import Path

import typer
from sqlmodel import Session

from aymurai.database.seed.catalogs import seed_catalogs, seed_macro_sectors
from aymurai.database.seed.organigram import seed_organigram
from aymurai.database.session import get_engine
from aymurai.logger import get_logger
from aymurai.settings import settings

app = typer.Typer()
logger = get_logger(__name__)


@app.command()
def catalogs(
    taxonomy_path: Path = typer.Option(  # noqa: B008 -- required Typer idiom
        None,
        help="Path to defensoria_taxonomy.json. Defaults to "
        "<RESOURCES_BASEPATH>/llm/defensoria_taxonomy.json.",
    ),
) -> None:
    """Seed topic/subtopic (from the taxonomy JSON) and the 4 macro sectors."""
    taxonomy_path = (
        taxonomy_path
        or Path(settings.RESOURCES_BASEPATH) / "llm" / "defensoria_taxonomy.json"
    )

    with Session(get_engine()) as session:
        macro_sector_count = seed_macro_sectors(session)
        topic_count, subtopic_count = seed_catalogs(session, taxonomy_path)

    typer.echo(
        f"Seeded {topic_count} topics, {subtopic_count} subtopics, "
        f"{macro_sector_count} macro sectors."
    )


@app.command()
def organigram(
    organigram_path: Path = typer.Option(  # noqa: B008 -- required Typer idiom
        None,
        help="Path to organigram_GCBA.json. Defaults to "
        "<RESOURCES_BASEPATH>/data/restricted/defensoria/organigram_GCBA.json.",
    ),
    csv_path: Path = typer.Option(  # noqa: B008 -- required Typer idiom
        None,
        help="Path to destinatario_por_sector.csv. Defaults to "
        "<RESOURCES_BASEPATH>/data/restricted/defensoria/destinatario_por_sector.csv.",
    ),
) -> None:
    """Seed the organigram tree and set `is_sector` from the 5 historical rules."""
    base = Path(settings.RESOURCES_BASEPATH) / "data" / "restricted" / "defensoria"
    organigram_path = organigram_path or base / "organigram_GCBA.json"
    csv_path = csv_path or base / "destinatario_por_sector.csv"

    with Session(get_engine()) as session:
        counts = seed_organigram(session, organigram_path, csv_path)

    typer.echo(
        f"Seeded {counts['nodes']} nodes, {counts['holders']} holders, "
        f"{counts['sectors']} sectors."
    )


if __name__ == "__main__":
    app()
