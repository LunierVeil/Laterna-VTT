#!/usr/bin/env bash
# Запуск для игры: один процесс, один порт - и страница, и API.
#
#   ./laterna.sh          собрать фронт (если менялся) и поднять стол на :8000
#   ./laterna.sh gm       напечатать ссылку ГМ
#
# PORT=9000 ./laterna.sh - другой порт.
#
# Для разработки - ./dev.sh (vite с горячей перезагрузкой на :5173).
# Слушает всю локальную сеть, чтобы зашли игроки. В интернет без
# HTTPS-прокси не выставлять: вход идёт без шифрования.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/server/.venv"
PY="$VENV/bin/python"
PORT="${PORT:-8000}"
DIST="$ROOT/web/dist"

port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

if [ "${1:-}" = gm ]; then
  KEY_FILE="$ROOT/server/gm_key.txt"
  if [ ! -f "$KEY_FILE" ]; then
    echo "ключа ещё нет - запусти ./laterna.sh, он создастся при первом старте"
    exit 1
  fi
  echo "http://localhost:$PORT/?gm=$(tr -d '[:space:]' < "$KEY_FILE")"
  echo "Не показывай её игрокам."
  exit 0
elif [ -n "${1:-}" ]; then
  echo "неизвестная команда: $1 (есть: gm)"
  exit 1
fi

command -v python3 >/dev/null || { echo "нужен python3 (3.11+)"; exit 1; }

if [ ! -x "$PY" ]; then
  echo "> создаю server/.venv"
  python3 -m venv "$VENV"
  "$PY" -m pip install -q -r "$ROOT/server/requirements.txt"
fi

# Собираем, если сборки нет или исходники новее её. Node нужен только
# для сборки - готовый dist сервер отдаёт сам.
if [ ! -f "$DIST/index.html" ] || [ -n "$(find "$ROOT/web/src" "$ROOT/web/index.html" "$ROOT/web/package.json" -newer "$DIST/index.html" -print -quit)" ]; then
  command -v npm >/dev/null || { echo "нужен Node.js (npm), чтобы собрать фронт"; exit 1; }
  if [ ! -d "$ROOT/web/node_modules" ]; then
    echo "> npm install"
    (cd "$ROOT/web" && npm install --silent)
  fi
  echo "> собираю фронт"
  (cd "$ROOT/web" && npm run build --silent)
fi

if port_busy "$PORT"; then
  echo "порт $PORT уже занят - похоже, старый запуск ещё жив (или ./dev.sh). Погаси его и повтори."
  exit 1
fi

# Адрес в локальной сети - его дают игрокам.
LAN="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

echo
echo "  Стол:   http://localhost:$PORT"
[ -n "$LAN" ] && echo "  Игрокам в этой сети: http://$LAN:$PORT"
echo "  ГМ:     ./laterna.sh gm в другом терминале - напечатает ссылку"
echo "  Ctrl+C - остановить"
echo

cd "$ROOT/server"
# FRONTEND_URL - для ссылки ГМ при первом старте: страница теперь на этом же порту.
FRONTEND_URL="${FRONTEND_URL:-http://localhost:$PORT}" WEB_DIST="$DIST" \
  exec "$VENV/bin/uvicorn" app.main:app --host 0.0.0.0 --port "$PORT"
