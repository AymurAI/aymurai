import json
from datetime import date, datetime
from typing import Any


def json_serial(obj: Any) -> str:
    """
    JSON serializer for objects not serializable by default JSON encoder.

    Args:
        obj (Any): The object to serialize. This function currently supports
             datetime.date and datetime.datetime objects.

    Returns:
        str: The ISO 8601 formatted string representation of the date or datetime object.

    Raises:
        TypeError: If the object is not of type datetime.date or datetime.datetime.
    """
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")


def save_json(json_data: dict | list[dict], file_path: str) -> None:
    """
    Saves a JSON object to a file.

    Args:
        json_data (dict | list[dict]): The JSON data to be saved.
        file_path (str): The path to the file where the JSON data will be saved.
    """
    with open(file_path, "w") as f:
        f.write(
            json.dumps(json_data, indent=4, ensure_ascii=False, default=json_serial)
        )


def load_json(json_file_path: str) -> dict | list[dict]:
    """
    Loads a JSON object from a file.

    Args:
        json_file_path (str): The path to the JSON file.

    Returns:
        dict | list[dict]: The loaded JSON object.
    """
    with open(json_file_path, "r") as f:
        content = json.loads(f.read())
        return content


def get_pretty(data: dict | list) -> str:
    """
    Renders a JSON-serializable object as an indented, human-readable string.

    Args:
        data (dict | list): The data to render.

    Returns:
        str: The indented JSON string representation.
    """
    return json.dumps(data, indent=2, ensure_ascii=False, default=json_serial)
