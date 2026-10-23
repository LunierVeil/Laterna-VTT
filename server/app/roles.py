"""Роли. Пока их две: ГМ и игрок.

Это не аутентификация: имя игрока по-прежнему приходит query-параметром
и не проверяется. Но ГМ определяется не по имени, а по секретному ключу -
иначе любой игрок вписал бы имя мастера и увидел скрытые сцены.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass

from .config import GM_KEY_FILE


@dataclass(frozen=True)
class Actor:
    """Кто прислал команду. Хендлеры проверяют права по нему."""

    name: str
    is_gm: bool = False


def _load_gm_key() -> str:
    # Ключ живёт в файле, а не генерируется на каждый старт: uvicorn
    # --reload перезапускается на каждую правку кода, и ГМ терял бы права.
    env = os.getenv("LANTERNA_GM_KEY")
    if env:
        return env.strip()
    if GM_KEY_FILE.is_file():
        return GM_KEY_FILE.read_text().strip()
    key = secrets.token_urlsafe(18)
    GM_KEY_FILE.write_text(key + "\n")
    GM_KEY_FILE.chmod(0o600)
    return key


GM_KEY = _load_gm_key()

# Ключ едет в cookie, а не в query-параметре: адрес сокета uvicorn пишет
# в лог, а логи потом вставляют в чаты, когда просят помощи.
GM_COOKIE = "lanterna_gm"


def is_gm_key(key: str | None) -> bool:
    if not key:
        return False
    # compare_digest - чтобы ключ нельзя было подобрать по времени ответа.
    return secrets.compare_digest(key.encode(), GM_KEY.encode())
