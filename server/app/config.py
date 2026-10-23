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

# Больше этого WebGL на части видеокарт текстуру не примет.
MAX_SCENE_SIDE = 8192
