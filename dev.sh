#!/usr/bin/env bash
# Локальный запуск без docker.
#
#   ./dev.sh          поднять сервер (:8000) и фронт (:5173), Ctrl+C - погасить оба
#   ./dev.sh reset    то же, но сначала стереть базу и загруженные карты
#   ./dev.sh check    тайпчек фронта + smoke_test (сервер должен быть запущен)
#   ./dev.sh gm       напечатать ссылку ГМ (ключ из server/gm_key.txt)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/server/.venv"
PY="$VENV/bin/python"

need_deps() {
  if [ ! -x "$PY" ]; then
    echo "> создаю server/.venv"
    python3 -m venv "$VENV"
    "$PY" -m pip install -q -r "$ROOT/server/requirements.txt"
  fi
  if [ ! -d "$ROOT/web/node_modules" ]; then
    echo "> npm install"
    (cd "$ROOT/web" && npm install --silent)
  fi
}

port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

case "${1:-}" in
  gm)
    # Ссылка по запросу, а не в каждом логе сервера: логи потом вставляют
    # в чаты, когда просят помощи.
    KEY_FILE="$ROOT/server/gm_key.txt"
    if [ ! -f "$KEY_FILE" ]; then
      echo "ключа ещё нет - запусти ./dev.sh, он создастся при первом старте"
      exit 1
    fi
    echo "http://localhost:5173/?gm=$(tr -d '[:space:]' < "$KEY_FILE")"
    echo "Не показывай её игрокам."
    exit 0
    ;;
  check)
    need_deps
    echo "> tsc"
    (cd "$ROOT/web" && npx --no-install tsc --noEmit -p .)
    echo "> smoke_test"
    # Не "порт открыт", а "сервер отвечает": uvicorn --reload держит порт
    # и тогда, когда рабочий процесс упал или ещё поднимается.
    if ! port_busy 8000; then
      echo "сервер на :8000 не запущен - сначала ./dev.sh в другом терминале"
      exit 1
    fi
    if ! "$PY" -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/api/health', timeout=3)" 2>/dev/null; then
      echo "порт 8000 открыт, но сервер не отвечает."
      echo "Посмотри терминал с ./dev.sh - там, скорее всего, traceback. Или сервер ещё поднимается."
      exit 1
    fi
    (cd "$ROOT/server" && "$PY" smoke_test.py)
    exit 0
    ;;
  reset) RESET=1 ;;
  "") ;;
  *)
    echo "неизвестная команда: $1 (есть: reset, check)"
    exit 1
    ;;
esac

need_deps

for p in 8000 5173; do
  if port_busy "$p"; then
    echo "порт $p уже занят - похоже, старый запуск ещё жив. Погаси его и повтори."
    exit 1
  fi
done

# Стираем только после проверки портов - не из-под живого сервера.
if [ "${RESET:-}" = 1 ]; then
  rm -f "$ROOT/server/lanterna.db"
  # Без базы ссылок на эти файлы не осталось.
  rm -rf "$ROOT/server/uploads"
  echo "> база и загрузки стёрты"
fi

# Оба процесса в одной группе: Ctrl+C гасит и сервер, и vite.
trap 'kill 0' EXIT

(cd "$ROOT/server" && "$VENV/bin/uvicorn" app.main:app --reload --port 8000) &

# Фронт после сервера, иначе первые запросы прокси падают с ECONNREFUSED.
for _ in $(seq 50); do port_busy 8000 && break; sleep 0.2; done

(cd "$ROOT/web" && npm run dev --silent) &

echo
echo "  ГМ:    ./dev.sh gm в другом терминале - напечатает ссылку"
echo "  Игрок: http://127.0.0.1:5173   (другой адрес = другое имя и без прав ГМ)"
echo "  Ctrl+C - остановить"
echo

wait
