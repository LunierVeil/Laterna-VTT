import os
from pathlib import Path

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite+aiosqlite:///./lanterna.db",
)

# Размер клетки по умолчанию, в пикселях сцены.
DEFAULT_GRID_SIZE = 70

# Загруженные карты. Локально - server/uploads, в docker - /app/uploads.
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", Path(__file__).resolve().parent.parent / "uploads"))
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

# Ключ ГМ создаётся здесь при первом запуске, если не задан LANTERNA_GM_KEY.
GM_KEY_FILE = Path(os.getenv("GM_KEY_FILE", Path(__file__).resolve().parent.parent / "gm_key.txt"))
# Куда вести ссылку ГМ, которую сервер печатает при старте.
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

# Больше этого WebGL на части видеокарт текстуру не примет.
MAX_SCENE_SIDE = 8192
