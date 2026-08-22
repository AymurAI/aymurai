from difflib import Differ, SequenceMatcher
from itertools import pairwise

import pandas as pd
from more_itertools import flatten


def tokenize(text: str) -> list[str]:
    """
    Split multi-line text into whitespace-delimited tokens.

    Args:
        text (str): Input text to tokenize.

    Returns:
        list[str]: Tokens extracted from the text.
    """
    tokens = map(str.split, text.splitlines())
    tokens = flatten(tokens)
    return list(tokens)


def align_text(
    source_text: str,
    target_text: str,
    columns: tuple[str, str] = ("source", "target"),
) -> pd.DataFrame:
    """
    Align source and target text into a token-level mapping table.

    Args:
        source_text (str): Reference text.
        target_text (str): Text to align against `source_text`.
        columns (tuple[str, str], optional): Output column names.
            Defaults to ("source", "target").

    Returns:
        pd.DataFrame: Alignment table.
    """
    source_tokens = [t.strip() for t in tokenize(source_text)]
    target_tokens = [t.strip() for t in tokenize(target_text)]

    mapping = pd.DataFrame(columns=("source", "target"))

    seqmatcher = SequenceMatcher(None, source_tokens, target_tokens)
    matches = seqmatcher.get_matching_blocks()

    # FIXME: patch to misaligned headers
    if not target_text:
        mapping["source"] = source_tokens
        mapping.fillna("", inplace=True)
    else:
        for match, next_match in pairwise(matches):
            _aux = {
                "source": source_tokens[match.a : match.a + match.size],
                "target": target_tokens[match.b : match.b + match.size],
            }
            mapping = pd.concat([mapping, pd.DataFrame(_aux)], ignore_index=True)

            # get how differ the tokens at the end of the current match to the next
            diff = Differ().compare(
                source_tokens[match.a + match.size : next_match.a],
                target_tokens[match.b + match.size : next_match.b],
            )
            diff = list(diff)
            left = [t[2:].strip() for t in diff if t.startswith(("-", " "))]
            right = [t[2:].strip() for t in diff if t.startswith("+")]
            right_agg = " ".join(right)

            _aux = pd.DataFrame({"source": left})
            _aux["target"] = right_agg

            mapping = pd.concat([mapping, pd.DataFrame(_aux)], ignore_index=True)

    # rename columns
    mapping.columns = columns

    return mapping.reset_index(drop=True)
