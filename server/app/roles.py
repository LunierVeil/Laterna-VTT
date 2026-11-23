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


def _load_gm_key(*, allow_create: bool) -> tuple[str, str]:
    """Ключ и откуда он: "env", "file" или "created" (только что создан)."""
    # Ключ живёт в файле, а не генерируется на каждый старт: uvicorn
    # --reload перезапускается на каждую правку кода, и ГМ терял бы права.
    env = os.getenv("LANTERNA_GM_KEY")
    if env:
        return env.strip(), "env"
    if GM_KEY_FILE.is_file():
        key = GM_KEY_FILE.read_text(encoding="utf-8").strip()
        if not key:
            raise RuntimeError(f"Файл ключа ГМ пуст: {GM_KEY_FILE}")
        return key, "file"
    if not allow_create:
        raise RuntimeError(f"Файл ключа ГМ исчез после preflight: {GM_KEY_FILE}")
    key = secrets.token_urlsafe(18)
    with os.fdopen(os.open(GM_KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600),
                   "w", encoding="utf-8") as key_file:
        key_file.write(key + "\n")
    return key, "created"


GM_KEY, GM_KEY_SOURCE = "", ""


def initialize_gm_key(*, allow_create: bool) -> None:
    global GM_KEY, GM_KEY_SOURCE
    GM_KEY, GM_KEY_SOURCE = _load_gm_key(allow_create=allow_create)


def gm_key_notice() -> str:
    """Describe the key source without logging the recovery credential."""
    if GM_KEY_SOURCE == "created":
        if os.name == "nt":
            return "Создан ключ ГМ. Ссылку показывает пункт 3 меню Laterna."
        return "Создан ключ ГМ. Ссылку показывает ./laterna.sh gm (или ./dev.sh gm)."
    if GM_KEY_SOURCE == "env":
        if len(GM_KEY) < 16:
            # Ключ - полный доступ к серверу. Короткий подбирается.
            return (
                "Ключ ГМ - из LANTERNA_GM_KEY.\n"
                f"  ВНИМАНИЕ: ключ короче 16 символов ({len(GM_KEY)}) - его можно подобрать. "
                "Не открывай такой стол в интернет."
            )
        return "Ключ ГМ - из LANTERNA_GM_KEY."
    return f"Ключ ГМ - в {GM_KEY_FILE}. Ссылка: ./laterna.sh gm (или ./dev.sh gm)"


def is_gm_key(key: str | None) -> bool:
    if not key:
        return False
    # compare_digest - чтобы ключ нельзя было подобрать по времени ответа.
    return secrets.compare_digest(key.encode(), GM_KEY.encode())
