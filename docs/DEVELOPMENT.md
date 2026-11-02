# Локальная разработка и Pull Request

Функциональная альфа завершена. Design System, упрощённый FSD с Zustand store/actions/selectors и модульный монолит FastAPI - следующие отдельные задачи. Здесь они не начаты. B01/B02 через Porthole и исходный выход рамки листа B14 остаются открытыми: см. docs/BUGS.md.

## Окружение

Проверяемая конфигурация: Python 3.12 (`.python-version`) и Node 24 LTS (`.nvmrc`). Node 20 не подходит для прямого запуска существующих TypeScript-тестов. Windows ZIP содержит встроенный Python 3.12; Node нужен только сборщику, не игроку.

Из корня свежей копии:

```bash
python3.12 -m venv server/.venv
server/.venv/bin/python -m pip install -r server/requirements.txt
cd web
npm ci
cd ..
./dev.sh
```

Vite: http://localhost:5173, API: http://127.0.0.1:8000. Игровой запуск: `./laterna.sh`, `./laterna.sh porthole` или `./laterna.sh tunnel`; подробности в README и FIRST_SESSION.md. `.env.example` - пример параметров, не автоматически загружаемый конфиг. Секретные значения задаются в локальном окружении, не в Git.

`dev.sh reset` удаляет игровую базу и uploads. Для тестов его не использовать. `dev.sh check` не заменяет полный CI: он требует живой сервер для smoke и не запускает production build/Chromium.

## Все проверки

```bash
# Корень; pytest сам устанавливает временные DATABASE_URL/UPLOAD_DIR/GM_KEY_FILE.
server/.venv/bin/python -m pytest server/tests -q
python3 -m unittest discover -s scripts/tests -v
cd web
npm ci
npm run typecheck
npm test
npm run build
npx --no-install playwright install --with-deps chromium
npm run test:browser
```

В Linux для системного Chromium допустим `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`; CI устанавливает версию браузера из package-lock Playwright. На Windows разработчику browser fixture сейчас требуется POSIX-структура `server/.venv/bin` - полный браузерный прогон выполняйте в WSL/Linux; Windows ZIP отдельно проверяется в Windows Actions.

Browser fixture сам выбирает свободные порты, создаёт временную SQLite/uploads/ключ и тестовые аккаунты, запускает uvicorn/Vite, ждёт `/api/health`, выполняет оригинальный `server/smoke_test.py`, затем 26 сценариев с настоящим Chromium. Останавливает дочерние серверы и удаляет тестовые данные. Не направляйте `smoke_test.py` вручную на пользовательский сервер: он меняет тестовые сущности; в CI используется только изолированный fixture. Скриншоты и server/Vite logs сохраняются в `BROWSER_RESULTS_DIR` (по умолчанию temp/laterna-browser-results).

## Работа через PR

1. После перехода клонировать новый репозиторий заново. Не смешивать старую и новую несвязанные истории.
2. Создать ветку `git switch -c fix/short-description` от актуального master.
3. Внести изменение, добавить соответствующую регрессию и обновить документацию.
4. В PR описать проблему, итоговое поведение, проверки и ограничения. Не включать данные кампаний/логи/ключи.
5. Дождаться `CI required`, устранить ошибки и конфликты; слить PR средствами GitHub. Новые функции не пушить прямо в master после включения защиты.

Для одного владельца защита требует PR и CI, но не чужой approval (`required_approving_review_count: 0`). Когда появятся reviewers, владелец может отдельно включить один обязательный approval. Не включать запрет self-review без второго доступного reviewer.

## Обновление локальной установки

Внутри новой истории: сначала остановить стол и сохранить игровые данные по REPOSITORY_MIGRATION.md, затем `git status --short` и `git pull --ff-only`. Если есть свои изменения - остановиться и сохранить их отдельной веткой/копией, не использовать reset/clean. Далее:

```bash
server/.venv/bin/python -m pip install -r server/requirements.txt
cd web
npm ci
npm run build
```

Первый переход Alpha Legacy -> новый Laterna-VTT делается новым clone/папкой, а не pull с `--allow-unrelated-histories`. Windows: распаковать новый проверенный ZIP в новую папку, сохранить старую папку, после резервного копирования перенести только свои DB/uploads/ключ, не старые Python/app/dist. Изменения схемы сначала проверять на копии базы. Запуск может выполнить добавочные миграции; откат бинарника не равен откату данных.


## Локальный Compose и очистка

Compose использует тестовые PostgreSQL credentials и bind mounts для разработки, не для production. Обычный `docker compose down` не удаляет именованный volume pgdata. Не использовать `down -v` или volume prune для пользовательских данных. `make clean` очищает только web/dist. Dockerfile frontend использует тот же Node 24 и npm ci, что локальная разработка/CI.

Для Codex инструкции находятся в корневом AGENTS.md. CLAUDE.md может существовать только как локальный игнорируемый файл; в Initial Commit он не включается.
