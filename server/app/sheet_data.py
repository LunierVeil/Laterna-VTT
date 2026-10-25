"""Проверка данных листа без знания правил.

Какие поля бывают, знает только схема листа на клиенте. Сервер следит за
формой: путь к полю - из простых сегментов, значение - обычный JSON
разумного размера. Этого достаточно, чтобы лист нельзя было раздуть или
сломать, и не нужно дублировать схему на сервере.
"""

from __future__ import annotations

import json
import math
import re
import secrets

from .richtext import clean_docs

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
        # Описания умений и предметов из редактора - через тот же белый
        # список, что и импорт: текст видит вся кампания.
        value = clean_docs(value)
        node = data
        for part in parts[:-1]:
            nxt = node.get(part)
            if not isinstance(nxt, dict):
                nxt = node[part] = {}
            node = nxt
        node[parts[-1]] = value
    dump(data)  # проверка размера
    return data


def _at(data: dict, parts: list[str], create: bool = False):
    """Родитель и ключ по пути; create - создать промежуточные объекты."""
    node = data
    for part in parts[:-1]:
        nxt = node.get(part)
        if not isinstance(nxt, dict):
            if not create:
                return None, parts[-1]
            nxt = node[part] = {}
        node = nxt
    return node, parts[-1]


MAX_LIST = 500
_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")


def apply_list(data: dict, path: object, op: object, item: object = None, item_id: object = None, changes: object = None) -> dict:
    """Элемент списка по id: add / update / remove. Список целиком клиент не
    присылает - иначе два одновременных добавления затёрли бы друг друга.
    id нового элемента выдаёт сервер."""
    parts = parse_path(path)
    parent, key = _at(data, parts, create=op == "add")
    current = parent.get(key) if parent is not None else None
    if current is None:
        current = []
    if not isinstance(current, list):
        raise SheetError("по этому пути не список")
    if op == "add":
        if not isinstance(item, dict):
            raise SheetError("элемент - объект")
        if len(current) >= MAX_LIST:
            raise SheetError("список слишком длинный")
        check_value(item)
        new = clean_docs({k: v for k, v in item.items() if k != "id"})
        new["id"] = f"i-{secrets.token_hex(6)}"
        parent[key] = [*current, new]
    elif op in ("update", "remove"):
        if not isinstance(item_id, str) or not _ID.fullmatch(item_id):
            raise SheetError("нет id элемента")
        index = next((i for i, x in enumerate(current) if isinstance(x, dict) and x.get("id") == item_id), None)
        if index is None:
            raise SheetError("элемент не найден")
        if op == "remove":
            parent[key] = current[:index] + current[index + 1:]
        else:
            if not isinstance(changes, dict) or not changes:
                raise SheetError("нечего менять")
            for name in changes:
                if not isinstance(name, str) or not _SEGMENT.fullmatch(name) or name == "id":
                    raise SheetError(f"недопустимое поле: {str(name)[:40]!r}")
            check_value(changes)
            parent[key] = [*current[:index], {**current[index], **clean_docs(changes)}, *current[index + 1:]]
    else:
        raise SheetError("неизвестная операция со списком")
    dump(data)
    return data


def apply_counter(data: dict, path: object, delta: object, max_path: object = None) -> dict:
    """Число по пути += delta, не ниже 0 и не выше значения по max_path.

    "Потратить ячейку" - так: клиент присылает -1, а сколько осталось,
    считает сервер по тому, что у него, а не по тому, что видел клиент.
    Пустое значение считается полным (= максимуму), если максимум есть.
    """
    if isinstance(delta, bool) or not isinstance(delta, int) or not -100 <= delta <= 100:
        raise SheetError("изменение - целое от -100 до 100")
    parts = parse_path(path)
    top = None
    if max_path is not None:
        mparent, mkey = _at(data, parse_path(max_path))
        value = mparent.get(mkey) if mparent is not None else None
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            top = int(value)
    parent, key = _at(data, parts, create=True)
    current = parent.get(key)
    if isinstance(current, bool) or not isinstance(current, (int, float)):
        current = top if top is not None else 0
    value = max(0, int(current) + delta)
    if top is not None:
        value = min(value, top)
    parent[key] = value
    dump(data)
    return data


def dump(data: dict) -> str:
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(text.encode()) > MAX_DATA_BYTES:
        raise SheetError("лист слишком большой")
    return text
