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
# Игрок загружает картинки своих токенов - им хватит и меньшего, а диск
# мастера не забьют.
MAX_PLAYER_UPLOAD_BYTES = 5 * 1024 * 1024

# Ключ ГМ создаётся здесь при первом запуске, если не задан LANTERNA_GM_KEY.
GM_KEY_FILE = Path(os.getenv("GM_KEY_FILE", Path(__file__).resolve().parent.parent / "gm_key.txt"))
# Адреса фронта, через запятую. Первый - для ссылки ГМ, которую сервер
# печатает при старте; все - разрешённые Origin для websocket.
FRONTEND_URLS = [
    u.strip().rstrip("/")
    for u in os.getenv("FRONTEND_URL", "http://localhost:5173").split(",")
    if u.strip()
]
FRONTEND_URL = FRONTEND_URLS[0]

# Публичный адрес стола - ссылка туннеля (./laterna.sh tunnel). По нему
# мастер раздаёт приглашения: сам он сидит на localhost, а игрокам нужен
# адрес из интернета. Пусто - приглашения с адреса, где открыт стол.
PUBLIC_URL = os.getenv("PUBLIC_URL", "").strip().rstrip("/") or None

# Собранный фронт (npm run build). Есть - сервер отдаёт и его: игра и API
# на одном порту, vite не нужен (./laterna.sh). Нет - только API, фронт
# отдаёт vite (./dev.sh).
WEB_DIST = Path(os.getenv("WEB_DIST", Path(__file__).resolve().parent.parent.parent / "web" / "dist"))

# Больше этого WebGL на части видеокарт текстуру не примет.
MAX_SCENE_SIDE = 8192

# Попытки входа: столько неудач за окно (секунды) - и 429. По паре
# "адрес + имя" и, мягче, по одному адресу (перебор разных имён).
LOGIN_MAX_FAILURES = 5
LOGIN_MAX_FAILURES_PER_IP = 20
LOGIN_WINDOW = 600
# По имени, с любого адреса: подбор пароля к одному игроку с разных адресов
# или через Porthole, где все приходят с 127.0.0.1.
LOGIN_MAX_FAILURES_PER_NAME = 30
LOGIN_NAME_WINDOW = 3600

# Адрес клиента из X-Forwarded-For - только если включено. Заголовок
# подделывает кто угодно; верить ему можно, лишь когда перед сервером
# свой прокси (туннель), и только для запросов с этой же машины.
TRUST_PROXY = os.getenv("LANTERNA_TRUST_PROXY", "").lower() in ("1", "true", "yes")
