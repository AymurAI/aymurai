import datetime
import decimal
import json
from typing import Any

import numpy as np
import pandas as pd

from aymurai.logger import get_logger

logger = get_logger(__name__)


class EnhancedJSONEncoder(json.JSONEncoder):
    """JSON encoder with support for datetime, timedelta, decimal, and NA values."""

    def default(self, obj: Any) -> Any:
        """
        Encode unsupported Python objects into JSON-serializable payloads.

        Args:
            obj (Any): Object to encode.

        Returns:
            Any: JSON-serializable representation of `obj`.

        Raises:
            TypeError: If `obj` cannot be encoded by the custom logic or parent
                JSON encoder.
        """
        if isinstance(obj, datetime.datetime):
            ARGS = ("year", "month", "day", "hour", "minute", "second", "microsecond")
            return {
                "__type__": "datetime.datetime",
                "args": [getattr(obj, a) for a in ARGS],
            }
        elif isinstance(obj, datetime.date):
            ARGS = ("year", "month", "day")
            return {
                "__type__": "datetime.date",
                "args": [getattr(obj, a) for a in ARGS],
            }
        elif isinstance(obj, datetime.time):
            ARGS = ("hour", "minute", "second", "microsecond")
            return {
                "__type__": "datetime.time",
                "args": [getattr(obj, a) for a in ARGS],
            }
        elif isinstance(obj, datetime.timedelta):
            ARGS = ("days", "seconds", "microseconds")
            return {
                "__type__": "datetime.timedelta",
                "args": [getattr(obj, a) for a in ARGS],
            }
        elif isinstance(obj, decimal.Decimal):
            return {
                "__type__": "decimal.Decimal",
                "args": [
                    str(obj),
                ],
            }
        elif isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif pd.isna(obj):
            return "null"
        else:
            try:
                return super().default(obj)
            except:
                logger.error(f"Error trying to encode {obj}")
                raise
