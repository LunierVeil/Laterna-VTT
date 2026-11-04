# Локальная разработка и Pull Request

**AS-IS, DOCS-00:** frontend FSD до FSD-09b и Design System завершены на master
`ff9681769978e295a763bcdea8aba536b7967566`. Backend modular monolith, устойчивый
DataHome/Alembic и расширенная Beta — будущая работа по [BETA_DECISIONS](BETA_DECISIONS.md).
Ручные B01/B02 через Porthole и исходный B14 не закрываются автоматизацией;
см. [BUGS](BUGS.md). Текущие пути: app/App.tsx, pages/table, widgets/scene-canvas,
shared/api/scene-socket.ts, state/public и systems/dnd5e (относительно web/src).

## Окружение

Python **3.12** ([.python-version](../.python-version)), Node **24** ([.nvmrc](../.nvmrc)),
npm ci по lockfile. Node 20 не подходит для прямых TypeScript-тестов.
Windows ZIP включает embedded Python; игроку Node не требуется. Для browser fixture
с POSIX server/.venv/bin используйте Linux/WSL; ZIP отдельно проверяется в Windows Actions.

Из корня свежей копии:

```bash
python3.12 -m venv server/.venv
server/.venv/bin/python -m pip install -r server/requirements.txt
npm --prefix web ci
./dev.sh
```

Vite — http://localhost:5173, API — http://127.0.0.1:8000.
`./dev.sh` запускает оба процесса; Ctrl+C останавливает их. `./dev.sh check` требует
живой **тестовый** сервер и не заменяет build/Chromium. `dev.sh reset` — разрушительный
режим, не использовать для проверки пользовательской кампании.
`.env.example` — пример, не автоматически загружаемый конфиг; секреты не в Git.

## Игровой, ручной и Docker-запуск

Linux: `./laterna.sh`, `./laterna.sh porthole`, `./laterna.sh gm`, `PORT=9000 ./laterna.sh`.
Windows: laterna.bat из проверенного распакованного ZIP; исходный
[windows/laterna.bat](../windows/laterna.bat) требует embedded Python и собранный frontend
рядом. LAN/Porthole — [README](../README.md), [FIRST_SESSION](FIRST_SESSION.md).

Ручной backend, после создания venv выше:

```bash
cd server
.venv/bin/python -m uvicorn app.main:app --reload --port 8000 --no-proxy-headers
```

Frontend в другом терминале из корня:

```bash
npm --prefix web ci
npm --prefix web run dev
```

SQLite DATABASE_URL по умолчанию относителен cwd; скрипты запуска используют server.
UPLOAD_DIR и GM_KEY_FILE по умолчанию указывают в server. Это текущие пути Alpha,
не будущий DataHome. Не меняйте cwd/параметры поверх единственной игровой БД без проверки.

Dev Compose (существующая PostgreSQL-альтернатива):

```bash
docker compose up --build
```

Vite :5173, API :8000; тестовые credentials и bind mounts. Это не production
и не утверждённая topology Beta (цель G1 — SQLite/DataHome). `docker compose down`
сохраняет volume pgdata; `down -v` и volume prune запрещены для пользовательских данных.
`make clean` удаляет только web/dist; не путать с dev.sh reset.

## Экспериментальные подключения

Сохранённые рабочие режимы кода, **не официальное обещание поддержки Beta**:

```bash
./laterna.sh tunnel
TUNNEL_VIA=ssh ./laterna.sh tunnel
```

Первый требует cloudflared, аккаунт Cloudflare для quick tunnel не нужен; второй
использует ssh/localhost.run. PUBLIC_URL попадает в приглашения, вывод — в
server/tunnel.log. URL может меняться при перезапуске. При TLS/порт-7844 ошибке
проверьте доступность провайдера; SSH — существующая альтернатива. Региональные
блокировки/VPN/виртуальная LAN могут влиять на доступность; работоспособность
не гарантируется. Не выставляйте обычный HTTP-порт публично; нужны корректный
HTTPS-прокси, сессионные настройки и стойкие пароли. Меню/скрипты DOCS-00 не меняет.

## Все проверки

Только изолированные временные данные. Из корня:

```bash
server/.venv/bin/python -m pytest server/tests -q
server/.venv/bin/python -m unittest discover -s scripts/tests -v
python3 scripts/check-doc-links.py
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build
cd web
npx --no-install playwright install --with-deps chromium
npm run test:browser
```

pytest/Chromium fixtures устанавливают временные DATABASE_URL/UPLOAD_DIR/GM_KEY_FILE,
порты и тестовые аккаунты. Не направлять smoke_test.py вручную на пользовательский
сервер: он меняет сущности. Оригинальный smoke выполняется отдельной suite с
временной SQLite; backend/frontend counts сверяются на каждом SHA, не хардкодятся.

[Подтверждённый CI master №41884690439](https://github.com/LunierVeil/Laterna-VTT/actions/runs/41884690439):
backend/frontend и Chromium **38/38**, без failed/skipped/cancelled. На том же коде
локально: 169 backend, 118 frontend unit, 31 scripts tests; typecheck/build успешны.
Для DOCS-00 эти старые результаты не выдаются за новый запуск.

### Изолированные Chromium suites

Manifest — [run.mjs](../web/tests/browser/run.mjs), strict expected counts —
[ci_gate.py](../scripts/ci_gate.py); **13 suites, 37 UI cases + 1 smoke = 38**:

| Группа | Suites | Cases |
| --- | --- | --- |
| sheets | sheets, sheet-lifecycle | 9 |
| tokens | tokens, network | 8 |
| scenes | scenes, auth | 5 |
| interaction | chat-dice, ui, smoke, design-system, components-v03, initiative, catalog | 16 |

Из web: `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- --suite scenes`
или `npm run test:browser -- --group tokens`. Системный Chromium допустим локально;
CI устанавливает pinned Playwright browser. Неизвестная группа отвергается.

Каждый файл получает собственные DB/uploads/key, API/Vite, browser/contexts;
runner последователен внутри группы, GitHub matrix — четыре независимых runners.
Fixture [fixture.mjs](../web/tests/browser/fixture.mjs) закрывает процессы/contexts
в cleanup. BROWSER_RESULTS_DIR содержит подпапки suites, logs/screenshots/startup.json;
BROWSER_JUNIT=/absolute/path/results.xml включает новый JUnit, старый файл удаляется.
Тестовые БД и ключи не включаются в artifacts. Без sleep/ослабления assertions/gate.

## Работа через PR и CI

1. Актуальный master, чистый Git; отдельная ветка на логически связанный блок.
   Не смешивать старую несвязанную историю Alpha Legacy с новой.
2. Scope, regression tests, документация; игровые данные/секреты/логи не коммитить.
3. После разрешённого логического commit/push — Fast CI точного SHA; следующий этап
   только после success. Fast CI не публикует CI required и не разрешает merge.
4. Ready PR → Full CI актуального test merge: backend, frontend, четыре Chromium
   группы и CI required. Head/base/merge должны оставаться актуальными; strict gate
   отвергает failed/skipped/cancelled/stale evidence, см. [CI_CD](CI_CD.md).
5. Commit, push, создание PR, merge, release — по отдельному разрешению владельца.
   При разрешённом merge сохранять согласованный способ/историю, затем проверить CI master.

Ruleset master требует PR, CI required от GitHub Actions и up-to-date branch;
required approvals = 0 для одного владельца. Не обходить защиту и не менять настройки
без разрешения. Windows candidate — отдельный ручной запуск без публикации;
выпуск не должен следовать из обычного push master.

## Обновление и сохранность данных

Остановить стол; сохранить **БД + uploads + ключи** вне заменяемой папки приложения
по [REPOSITORY_MIGRATION](REPOSITORY_MIGRATION.md). В Windows ручной пункт «Копия базы»
копирует остановленную Alpha в backup; полноценные G3 automatic/pre-upgrade backups
и проверяемый restore ещё не внедрены. Не копировать живую SQLite обычным file copy,
не терять возможные WAL/SHM, не восстанавливать поверх единственного оригинала.
Instance backup ≠ экспорт одной кампании. Новый DataHome/Alembic — только отдельная
разработка с upgrade/restore tests, не команды DOCS-00.

Из чистой установки исходников после резервного копирования:

```bash
git status --short
git pull --ff-only
server/.venv/bin/python -m pip install -r server/requirements.txt
npm --prefix web ci
npm --prefix web run build
```

При незакоммиченных изменениях остановиться, сохранить их отдельно; без reset/clean.
Windows: новый проверенный ZIP в новую папку; перенос только копии DB/uploads/key,
не старых Python/app/dist. Старую папку не удалять до проверки. Запуск Alpha может
выполнить добавочные schema checks; откат бинарника не равен откату данных.
Не применять эти инструкции как разрешение на реальное обновление в docs-only задаче.

## Историческая диагностика CI (HISTORICAL)

Следующие результаты относятся к восстановлению CI, а не к текущему count 38.
Базы/наблюдения оставлены без пересчёта; новая проблема требует нового воспроизведения.

### Диагностика Final scenes

При восстановлении CI локальный полный прогон прошёл 27/27, а отдельная группа
scenes/auth — 5/5. Зависание третьего canvas не воспроизведено. В дополнительном
прогоне под нагрузкой mount мобильного renderer занял около 5,2 с; общий запуск
страницы — около 8 с (таймаут canvas отсчитывается после навигации).
Это наблюдение, не доказательство первопричины прежней ошибки.

Фикстура сохраняет startup.json: длительность pageFor, интервалы SceneStage.mount,
число contexts/pages, предупреждения консоли и признак ошибки. Существующие
таймауты, проверки StrictMode и assertions сценариев сохранены. Приложение и Scene
Engine не менялись. При повторном падении сравнивайте mount с загрузкой ресурсов,
ошибками страницы и серверными логами; не увеличивайте таймаут вслепую.


По результатам первого GitHub run 41449174292 B10 исчерпал общий лимит на
перебор двух типов листа. Теперь PC/NPC выполняются как самостоятельные тесты;
все шесть ширин, вкладки, view/edit и проверки переполнения сохранены.
В touch preview snapshot может прийти раньше нового renderer. После смены сцены
тест ждёт новый живой SceneStage и сразу проверяет отсутствие previews; ожидание
не подменяется polling до исчезновения неправильного preview.


Управляющий protocol-клиент фикстуры открывает `/api/health` на origin Vite,
использует cookies ГМ и probe WebSocket. Он не загружает SPA и не создаёт Pixi
renderer: его canvas нигде не проверялся, а постоянный software WebGL redraw
конкурировал с реальными GM/player/touch страницами. Все игровые страницы по-прежнему
запускаются через pageFor с прежним ожиданием canvas и проверками StrictMode.


[Design System](DESIGN_SYSTEM.md), [архитектурные границы](FSD_SYSTEM_BOUNDARIES.md).
