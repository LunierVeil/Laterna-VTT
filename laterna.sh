#!/usr/bin/env bash
# Запуск для игры: один процесс, один порт - и страница, и API.
#
#   ./laterna.sh          собрать фронт (если менялся) и поднять стол на :8000
#   ./laterna.sh tunnel   то же + публичная ссылка через cloudflared (без
#                         проброса портов и без аккаунта Cloudflare)
#   TUNNEL_VIA=ssh ./laterna.sh tunnel
#                         туннель через ssh (localhost.run) - если провайдер
#                         режет туннели Cloudflare; ставить ничего не нужно
#   ./laterna.sh gm       напечатать ссылку ГМ
#
# PORT=9000 ./laterna.sh - другой порт.
#
# Для разработки - ./dev.sh (vite с горячей перезагрузкой на :5173).
# Слушает всю локальную сеть, чтобы зашли игроки. Порт в интернет не
# пробрасывать: по http вход идёт без шифрования. Для игроков из интернета -
# режим tunnel, там HTTPS даёт Cloudflare.
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
elif [ "${1:-}" = tunnel ]; then
  TUNNEL=1
elif [ -n "${1:-}" ]; then
  echo "неизвестная команда: $1 (есть: tunnel, gm)"
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

# Туннель. Адрес случайный и живёт, пока запущен скрипт; HTTPS даёт
# сервис туннеля. Сервер поднимаем после - адрес нужен ему для ссылок-
# приглашений (PUBLIC_URL). Вывод туннеля - в server/tunnel.log, он нужен,
# когда что-то не так.
PUBLIC=""
if [ "${TUNNEL:-}" = 1 ]; then
  TLOG="$ROOT/server/tunnel.log"
  : > "$TLOG"
  case "${TUNNEL_VIA:-cloudflared}" in
    cloudflared)
      if ! command -v cloudflared >/dev/null; then
        echo "нужен cloudflared:"
        echo "  Arch/CachyOS: sudo pacman -S cloudflared"
        echo "  Debian/Ubuntu, macOS, Windows: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
        echo "или без установки: TUNNEL_VIA=ssh ./laterna.sh tunnel"
        exit 1
      fi
      cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" > "$TLOG" 2>&1 &
      URL_RE='https://[a-z0-9-]+\.trycloudflare\.com'
      # Адрес cloudflared печатает сразу, а подключается к Cloudflare позже -
      # и может не подключиться. Ждём подключения, иначе игрок получит 1033.
      READY_RE='Registered tunnel connection'
      ;;
    ssh)
      command -v ssh >/dev/null || { echo "нужен ssh"; exit 1; }
      # accept-new: ключ localhost.run запомнится при первом запуске.
      ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
        -T -R "80:localhost:$PORT" nokey@localhost.run > "$TLOG" 2>&1 < /dev/null &
      URL_RE='https://[a-z0-9-]+\.lhr\.life'
      READY_RE="$URL_RE"
      ;;
    *)
      echo "TUNNEL_VIA: cloudflared или ssh"
      exit 1
      ;;
  esac
  TUN_PID=$!
  trap 'kill "$TUN_PID" 2>/dev/null' EXIT
  echo "> поднимаю туннель (${TUNNEL_VIA:-cloudflared})"
  for _ in $(seq 60); do
    if grep -qE "$READY_RE" "$TLOG"; then
      PUBLIC="$(grep -oE "$URL_RE" "$TLOG" | head -1 || true)"
      break
    fi
    kill -0 "$TUN_PID" 2>/dev/null || break
    sleep 0.5
  done
  if [ -z "$PUBLIC" ]; then
    echo "туннель не подключился за 30 секунд. Последние ошибки (весь вывод - server/tunnel.log):"
    grep -E "ERR|rror|denied|refused" "$TLOG" | tail -n 5 || tail -n 10 "$TLOG"
    if [ "${TUNNEL_VIA:-cloudflared}" = cloudflared ]; then
      echo
      echo "Если там «TLS handshake with edge error» или «port 7844» - провайдер режет"
      echo "туннели Cloudflare. Попробуй: TUNNEL_VIA=ssh ./laterna.sh tunnel (или VPN)."
      echo "Если есть ~/.cloudflared/config.yml - быстрый туннель с ним не стартует."
    fi
    exit 1
  fi
fi

# Адрес в локальной сети - его дают игрокам.
# Адрес, с которого машина ходит наружу; hostname -I есть не везде (на Arch нет).
LAN="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}' || true)"
[ -z "$LAN" ] && LAN="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

echo
echo "  Стол:   http://localhost:$PORT"
[ -n "$LAN" ] && echo "  Игрокам в этой сети: http://$LAN:$PORT"
if [ -n "$PUBLIC" ]; then
  echo "  Игрокам из интернета: $PUBLIC"
  echo "          Приглашения во вкладке «Игроки» сразу с этим адресом."
  echo "          Ссылка открыта всему интернету, а ограничения попыток входа пока нет -"
  echo "          пароли игрокам посложнее. Адрес новый при каждом запуске."
fi
echo "  ГМ:     ./laterna.sh gm в другом терминале - напечатает ссылку"
echo "  Ctrl+C - остановить"
echo

cd "$ROOT/server"
# FRONTEND_URL: первый - для ссылки ГМ при первом старте (страница на этом
# же порту), адрес туннеля - в разрешённые Origin сокета: не все сервисы
# туннелей передают серверу исходный Host.
ORIGINS="http://localhost:$PORT${PUBLIC:+,$PUBLIC}"
# Без exec: после сервера trap гасит туннель.
FRONTEND_URL="${FRONTEND_URL:-$ORIGINS}" WEB_DIST="$DIST" PUBLIC_URL="$PUBLIC" \
  "$VENV/bin/uvicorn" app.main:app --host 0.0.0.0 --port "$PORT"
