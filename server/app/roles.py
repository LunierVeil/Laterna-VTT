"""Роли и ключ ГМ.

Ролей две: ГМ и игрок, это флаг аккаунта (auth.py). Ключ ГМ - только
способ первого входа мастера: по нему он создаёт свой аккаунт, а если
забыл пароль - входит снова. Дальше всё решает сессия.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass

from .config import GM_KEY_FILE


@dataclass(frozen=True)
class Actor:
    """Кто прислал команду. Хендлеры проверяют права по нему.

    Берётся из сессии, а не из того, что прислал клиент.
    """

    id: str
    name: str
    is_gm: bool = False
    # sha256 токена сессии - чтобы при выходе закрыть сокеты именно этой
    # сессии, а не все входы игрока. Хендлерам не нужен.
    session: str = ""


def _load_gm_key() -> tuple[str, str]:
    """Ключ и откуда он: "env", "file" или "created" (только что создан)."""
    # Ключ живёт в файле, а не генерируется на каждый старт: uvicorn
    # --reload перезапускается на каждую правку кода, и ГМ терял бы права.
    env = os.getenv("LANTERNA_GM_KEY")
    if env:
        return env.strip(), "env"
    if GM_KEY_FILE.is_file():
        return GM_KEY_FILE.read_text().strip(), "file"
    key = secrets.token_urlsafe(18)
    GM_KEY_FILE.write_text(key + "\n")
    GM_KEY_FILE.chmod(0o600)
    return key, "created"


GM_KEY, GM_KEY_SOURCE = _load_gm_key()


def gm_key_notice(frontend_url: str) -> str:
    """Что сказать в лог при старте.

    Ссылку с ключом - только в момент создания: лог печатается на каждый
    перезапуск (а с --reload это каждая правка кода), и потом его
    вставляют в чаты, когда просят помощи. Дальше - только где лежит ключ.
    """
    if GM_KEY_SOURCE == "created":
        return (
            f"Создан ключ ГМ. Ссылка ГМ: {frontend_url}/?gm={GM_KEY}\n"
            f"  Не показывай её игрокам. Позже её выведет ./dev.sh gm."
        )
    if GM_KEY_SOURCE == "env":
        return "Ключ ГМ - из LANTERNA_GM_KEY."
    return f"Ключ ГМ - в {GM_KEY_FILE}. Ссылка: ./dev.sh gm"


def is_gm_key(key: str | None) -> bool:
    if not key:
        return False
    # compare_digest - чтобы ключ нельзя было подобрать по времени ответа.
    return secrets.compare_digest(key.encode(), GM_KEY.encode())
