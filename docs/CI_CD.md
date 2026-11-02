# CI/CD и выпуск кандидата

## CI

`.github/workflows/ci.yml`: push в master, PR в master и `workflow_call` из release. Официальные checkout/setup/upload/download Actions закреплены по проверенным commit SHA (Node 24 runtime; версии указаны рядом). Обновлять pins отдельным PR с проверкой action.yml, не подставлять непроверенный latest. Только `contents: read`; нет `pull_request_target` и секретов пользовательской установки. Устаревшие проверки одной ветки/PR отменяются. Сначала ref однократно разрешается в SHA; все jobs checkout именно его, без сохранённых Git credentials.

- backend: Python 3.12, pip cache по requirements, все pytest (включая миграции SQLite) и unittest безопасности снимка/экспорта; JUnit при падении.
- frontend: Node 24 LTS, npm cache по lockfile, `npm ci`, typecheck, unit, production build.
- browser: отдельный venv, npm ci, `playwright install --with-deps chromium`, полный существующий browser fixture и исходный smoke. Таймаут job 40 минут; ожидания и требования самих тестов не увеличены. `pipefail` сохраняет ненулевой код при записи runner.log через tee. Артефакты содержат screenshots, runner/server/Vite logs; тестовые БД и ключи не загружаются.
- `CI required`: выполняется и при ошибке/пропуске зависимости, требует success всех jobs. Именно его контекст используется защитой master. Выход `tested_sha` доступен release только после полного успеха.

Fixture завершает свои процессы штатно; при принудительном таймауте/cancel очистку потомков дополнительно выполняет GitHub runner. npm/pip cache хранит загрузки, не готовые node_modules/venv или данные кампаний. Внешние установки и workflow не исполнялись на настоящих GitHub runners в рамках подготовки: локальная валидация не заменяет первый Actions run.

## Windows release

`.github/workflows/windows-release.yml`: push нового тега `v*` или ручной `workflow_dispatch`. Обычный push master НЕ запускает выпуск. Ручной `publish=false` по умолчанию только проверяет и собирает кандидата.

Цепочка с техническими зависимостями:

```
candidate (SHA, existing tag validation)
  -> checks (reusable CI: backend + frontend + browser + CI required)
  -> windows (checkout tested_sha, compare candidate SHA, npm ci/build,
              portable embedded-Python ZIP, extracted-package smoke)
  -> publish (only when requested; protected release environment)
```

`windows` не стартует при failed/skipped/cancelled checks. Отдельная проверка подтверждает равенство candidate SHA, tested SHA и checkout HEAD. ZIP содержит SOURCE_COMMIT.txt и соседний SHA-256. Встроенный Python 3.12.10 x64, только готовые Windows wheels: не зависит от Python/пакетов/ключей сборщика. Сохраняются laterna.bat/ps1 и FIRST_SESSION. Пакет не содержит базы, uploads или реального ключа.

`scripts/test-windows-package.ps1` распаковывает именно ZIP в новый temp, запускает приложение через его python.exe с явным --app-dir (embedded ._pth не включает рабочий каталог), ждёт health и проверяет страницу, создаёт временного ГМ, затем тем же embedded Python запускает весь исходный smoke_test.py через package-smoke.py. DB/uploads/key изолированы вне распакованного приложения. Процесс останавливается в finally; temp удаляется; stdout/stderr доступны как диагностические artifacts при ошибке. Меню интерактивного launcher и физический Porthole всё ещё проверяются человеком.

Только `publish` получает `contents: write`; build/test jobs read-only. Перед публикацией снова проверяются tag -> SHA (включая удалённый ref), checksum ZIP и отсутствие существующего релиза. Создаётся draft, файлы загружаются без clobber, сверяются имена/размеры, затем draft публикуется как prerelease. Ошибка до последнего шага оставляет только неопубликованный draft. Ничего уже опубликованного не редактируется/не удаляется. Повторный запуск для существующего релиза/draft останавливается; владелец разбирает неуспешный draft вручную. Публикация уже прошедшего последнего API-запроса может завершиться до отмены job - это стандартная граница внешнего атомарного действия, не механизм отката опубликованного релиза.

## Кандидат без публикации

После согласованного первого push, Actions -> Windows release -> Run workflow:

- workflow branch: master;
- candidate_ref: конкретный полный SHA;
- publish: false;
- release_tag: пусто.

Либо у владельца локально:

```bash
gh workflow run windows-release.yml --ref master -f candidate_ref=FULL_SHA -f publish=false
```

Дождаться всех checks/windows, скачать ZIP и sha256 из artifacts, сверить checksum, распаковать в новую папку и проверить меню/запуск с компьютера без установленного Python. Это не создаёт теги или GitHub Release.

## Выпуск после отдельного разрешения

1. Выбрать уже проверенный коммит через PR, проверить README/package version и `docs/RELEASE_ALPHA.md` именно этого коммита. Не переносить теги Legacy на новый root.
2. Либо создать новый защищённый `vX.Y.Z...` тег на этом коммите и push только этого тега; либо использовать уже существующий matching tag и ручной workflow publish=true/release_tag. В этой подготовке ни один вариант не выполняется.
3. Повторно пройдут полные проверки и Windows package smoke. Артефакты одного запуска не подменяются артефактами другого.
4. В environment `release` после bootstrap настроить разрешённые tags и approval владельца/доверенного reviewer. Для единственного владельца не запрещать собственное approval. Без environment protection GitHub не добавляет ручной барьер автоматически; tag-trigger всё равно требует всех jobs.
5. Только после success и approval публикуется prerelease. Проверить SHA и checksum на GitHub. Production-релизы и смена prerelease-статуса пока отдельное решение.

В Cloud доступен Linux, а не Windows. Реальный Windows ZIP/startup/smoke и исполнение Actions до согласованного push НЕ проверены. Зависимости Python пока имеют диапазоны; каждый кандидат заново устанавливает их и проверяет собранный пакет. Полного побитового воспроизведения между датами/платформами не обещаем.
