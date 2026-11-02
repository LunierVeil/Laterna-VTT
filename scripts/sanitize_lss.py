#!/usr/bin/env python3
"""Убрать из файла Long Story Short то, что не нужно для тестов и выдаёт
игрока: портрет (ссылка на их сервер), служебные id и время.

    python scripts/sanitize_lss.py server/tests/fixtures/*.json

Удаляет ключи avatar, _id, lastWriterSessionId, createdAt на любой глубине -
и снаружи, и во вложенном data (JSON строкой внутри JSON). Тексты не меняет
и не укорачивает: тесты импорта проверяют именно их. Файл переписывается на
месте; повторный запуск ничего не меняет.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

DROP = {"avatar", "_id", "lastWriterSessionId", "createdAt"}


def strip(value: object) -> object:
    if isinstance(value, dict):
        return {k: strip(v) for k, v in value.items() if k not in DROP}
    if isinstance(value, list):
        return [strip(v) for v in value]
    return value


def sanitize(raw: str) -> str:
    outer = json.loads(raw)
    data = outer.get("data")
    if isinstance(data, str):
        # data - JSON строкой: чистим внутри и кладём обратно строкой.
        outer["data"] = json.dumps(strip(json.loads(data)), ensure_ascii=False)
    outer = strip(outer)
    return json.dumps(outer, ensure_ascii=False, indent=1) + "\n"


def main(paths: list[str]) -> int:
    if not paths:
        print(__doc__)
        return 1
    for name in paths:
        path = Path(name)
        before = path.read_text(encoding="utf-8")
        after = sanitize(before)
        if after != before:
            path.write_text(after, encoding="utf-8")
            print(f"очищен: {path}")
        else:
            print(f"без изменений: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
