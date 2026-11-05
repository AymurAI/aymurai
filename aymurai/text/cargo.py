"""
Cargo-text cleaning for organigram matching.

Turns a raw extracted cargo ("Directora General Obras en Vías Peatonales,
dependiente del Ministerio de Espacio Público...") into just the role clause
that names an organigram unit, dropping the parent-institution chain and the
GCBA boilerplate that appears in almost every cargo but never in a unit's own
`name`.

Pure text work with no session or model dependency, which is why it lives
next to `normalize_text` rather than in the matching router.
"""

import re

from aymurai.text.matching import normalize_text

# Role titles after which the following words name the actual cargo, e.g.
# "Secretario de Deportes del Ministerio de ..." -> the role is "Secretario de
# Deportes"; everything from "del Ministerio ..." on is the parent chain. The
# "de" right after the role is optional: some cargos read "Directora General
# Obras en Vías Peatonales" with no "de" before the topic.
CARGO_ROLE_PREFIXES = (
    "ministro",
    "ministra",
    # "General" here is part of the title ("Secretary General"), not the
    # start of the topic clause -- these must come before the bare
    # "secretario"/"secretaria" below, or the alternation matches the
    # shorter prefix first and "general" gets mistaken for the topic (regex
    # `|` alternation picks the first matching branch, not the longest).
    "secretario general",
    "secretaria general",
    "secretario",
    "secretaria",
    "subsecretario",
    "subsecretaria",
    "director general",
    "directora general",
    "director",
    "directora",
    "presidente",
    "presidenta",
    "titular",
    "jefe",
    "jefa",
    "interventor",
    "interventora",
    "coordinador",
    "coordinadora",
)
CARGO_ROLE_PATTERN = re.compile(
    r"^(" + "|".join(CARGO_ROLE_PREFIXES) + r")\b(?:\s+(?:de\s+)?)?"
)

# del/de la/de only counts as the parent-chain boundary when followed by an
# actual parent-institution noun -- otherwise "del"/"de la" inside a compound
# office name (e.g. "Registro del Estado Civil") gets mistaken for it.
PARENT_INSTITUTION_KEYWORDS = (
    "ministerio",
    "secretaria",
    "subsecretaria",
    "gobierno",
    "jefatura",
    "agencia",
    "ente",
    "sindicatura",
    "procuracion",
)
CARGO_PARENT_MARKERS = re.compile(
    r"\s*,?\s+(?:dependiente\s+)?(?:del|de la|de)\s+"
    r"(?=(?:" + "|".join(PARENT_INSTITUTION_KEYWORDS) + r")\b)"
)

# Boilerplate that shows up in almost every extracted position but never in
# the organigram's own `name` values, so it only adds noise to the match.
CARGO_NOISE_PATTERNS = [
    r"\bgobierno de la ciudad autonoma de buenos aires\b",
    r"\bgobierno de la ciudad de buenos aires\b",
    r"\bciudad autonoma de buenos aires\b",
    r"\bciudad de buenos aires\b",
]


def _extract_cargo_role(text: str) -> str:
    """
    Keep only the "<role> de <topic>" clause, dropping the "del/dependiente
    de/de la ..." parent-institution chain that follows a role title.

    Args:
        text (str): Already-normalized cargo text.

    Returns:
        str: Text with the parent-institution chain removed, if a role prefix was found.
    """
    match = CARGO_ROLE_PATTERN.match(text)
    if not match:
        return text
    rest = text[match.end() :]
    parent_match = CARGO_PARENT_MARKERS.search(rest)
    topic = (rest[: parent_match.start()] if parent_match else rest).strip()
    if not topic:
        return match.group(1).strip()
    first_word = topic.split(" ", 1)[0]
    if first_word not in ("de", "del", "dependiente"):
        topic = f"de {topic}"
    return f"{match.group(1)} {topic}".strip()


def _strip_noise_and_trailing(text: str) -> str:
    """
    Remove GCBA boilerplate phrases and any dangling trailing preposition.

    Args:
        text (str): Already-normalized cargo text.

    Returns:
        str: Cleaned text.
    """
    for pattern in CARGO_NOISE_PATTERNS:
        text = re.sub(pattern, " ", text)
    text = re.sub(
        r"\b(del|de la|de|dependiente(?: del| de la| de)?)\s*$", "", text.strip()
    )
    return re.sub(r"\s+", " ", text).strip()


def clean_cargo(value: str | None) -> str:
    """
    Normalize, extract the role-prefix clause, and strip GCBA boilerplate.

    Args:
        value (str | None): Raw cargo text.

    Returns:
        str: Cleaned cargo text, ready for matching.
    """
    return _strip_noise_and_trailing(_extract_cargo_role(normalize_text(value)))
