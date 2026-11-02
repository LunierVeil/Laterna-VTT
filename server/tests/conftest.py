"""Общее для pytest: сервер на временной базе, без живого процесса.

Окружение - до любого импорта app: config читает его при импорте, и иначе
тесты писали бы в настоящую server/lanterna.db мастера.
"""

from __future__ import annotations

import os
import secrets
import sys
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="laterna-tests-"))
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TMP / 'test.db'}"
os.environ["UPLOAD_DIR"] = str(_TMP / "uploads")
os.environ["GM_KEY_FILE"] = str(_TMP / "gm_key.txt")
os.environ["LANTERNA_GM_KEY"] = GM_KEY = secrets.token_urlsafe(18)
os.environ.pop("LANTERNA_TRUST_PROXY", None)
os.environ.pop("PUBLIC_URL", None)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
