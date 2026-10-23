import os

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite+aiosqlite:///./lanterna.db",
)

# Размер клетки по умолчанию, в пикселях сцены.
DEFAULT_GRID_SIZE = 70
