"""Проверка данных листа без знания правил.

Какие поля бывают, знает только схема листа на клиенте. Сервер следит за
формой: путь к полю - из простых сегментов, значение - обычный JSON
разумного размера. Этого достаточно, чтобы лист нельзя было раздуть или
сломать, и не нужно дублировать схему на сервере.
"""

from __future__ import annotations

import json
import re

MAX_DATA_BYTES = 256 * 1024
MAX_STRING = 20_000
# Тексты способностей - документы TipTap (doc > list > paragraph > text >
# marks ...), они глубже обычных полей.
MAX_DEPTH = 24
MAX_PATH_DEPTH = 6

_SEGMENT = re.compile(r"[A-Za-z0-9_-]{1,64}")


class SheetError(ValueError):
    pass


def check_value(value: object, depth: int = 0) -> None:
    if depth > MAX_DEPTH:
        raise SheetError("слишком глубокая вложенность")
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        if value != value or value in (float("inf"), float("-inf")):
            raise SheetError("число должно быть конечным")
        return
    if isinstance(value, str):
        if len(value) > MAX_STRING:
            raise SheetError("слишком длинный текст")
        return
    if isinstance(value, list):
        for item in value:
            check_value(item, depth + 1)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or not _SEGMENT.fullmatch(key):
                raise SheetError(f"недопустимое имя поля: {str(key)[:40]!r}")
            check_value(item, depth + 1)
        return
    raise SheetError("недопустимое значение")


def parse_path(path: object) -> list[str]:
    parts = str(path).split(".")
    if not parts or len(parts) > MAX_PATH_DEPTH or not all(_SEGMENT.fullmatch(p) for p in parts):
        raise SheetError(f"недопустимый путь к полю: {str(path)[:80]!r}")
    return parts


def apply_set(data: dict, changes: object) -> dict:
    """Записать {"путь.к.полю": значение, ...} в data. Промежуточные
    объекты создаются; списки целиком заменяются значением."""
    if not isinstance(changes, dict) or not changes:
        raise SheetError("нечего менять")
    for path, value in changes.items():
        parts = parse_path(path)
        check_value(value)
        node = data
        for part in parts[:-1]:
            nxt = node.get(part)
            if not isinstance(nxt, dict):
                nxt = node[part] = {}
            node = nxt
        node[parts[-1]] = value
    dump(data)  # проверка размера
    return data


def dump(data: dict) -> str:
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(text.encode()) > MAX_DATA_BYTES:
        raise SheetError("лист слишком большой")
    return text
