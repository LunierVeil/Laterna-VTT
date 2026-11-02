# CI/CD и выпуск кандидата

## Fast CI и Full CI

`fast-ci.yml` запускает backend и frontend при push в рабочие ветки и для draft PR.
Он проверяет pytest, служебные unittest, TypeScript, frontend unit и production build.
Chromium не устанавливается. Этот workflow не создаёт контекст `CI required`.

`ci.yml` (Full CI) запускается для готовых PR в master, после push в master,
вручную через workflow_dispatch и как reusable workflow для Windows candidate.
События ready_for_review и converted_to_draft учитываются явно. Для draft полный
набор не запускается, а gate не становится зелёным: быстрые проверки не дают
разрешения на merge. Устаревшие запуски одного PR/ветки отменяются.

Ref один раз разрешается в SHA. Backend, frontend и все Chromium-группы получают
одинаковый checkout. Backend/frontend сообщают SHA, run ID и attempt только после
успешных проверок. Chromium работает четырьмя независимыми jobs (fail-fast=false):

| Группа | Suites | Проверок |
| --- | --- | --- |
| sheets | sheets | 8 |
| tokens | tokens, network | 8 |
| scenes | scenes, auth | 5 |
| interaction | chat-dice, ui, smoke | 7 |

Всего 27 UI-тестов и самостоятельный smoke_test.py: исходный B10 разделён
на PC/NPC с теми же вкладками, режимами, ширинами и assertions. Каждый
случай имеет исходный лимит 120 секунд; лимит не увеличен. Каждая suite
имеет отдельную временную SQLite, uploads, ключ, API/Vite, порты, браузер и contexts.
Запуск внутри группы последовательный; группы работают на разных GitHub runners.
`BROWSER_RESULTS_DIR` разделён по группе и suite. В диагностику входят runner.log,
JUnit, server/Vite logs, screenshots и startup.json с временами создания canvas.
Базы и ключи в artifacts не включаются.

`scripts/ci_gate.py` проверяет реальные JUnit testcase: нулевой, неполный,
failed/skipped/disabled прогон не создаёт успешный evidence. Четыре evidence
артефакта связываются с SHA, github.run_id и github.run_attempt. `CI required`
исполняется через always() и отклоняет failed/cancelled/skipped jobs, отсутствующие
или повторные группы, старые SHA/run/attempt и несоответствие candidate SHA.
Выход tested_sha появляется только после полного успешного gate.

Для PR gate повторно читает GitHub API: PR должен оставаться открытым и готовым,
head/base SHA должны совпадать с событием, merge_commit_sha — с проверенным SHA.
При push master проверяется, что ветка не продвинулась. Ошибка API закрывает gate.
Частичный Re-run failed jobs может содержать результаты прежней попытки и будет
отклонён; используйте Re-run all jobs. Gate не ищет зелёные результаты других runs.

После завершения gate PR/ветка ещё могут измениться. Защита master должна требовать
`CI required` и актуальность ветки относительно base (strict required checks).
Без настройки branch protection локальная логика workflow не может атомарно
запретить merge. Изменения защиты master в этой задаче не выполняются.

Все Actions закреплены по SHA; checkout не сохраняет credentials. Нет
pull_request_target. Full CI получает contents:read и pull-requests:read;
право contents:write остаётся только у отдельного publish job.
Пакетные кэши привязаны к lockfile/requirements, готовые venv/node_modules и
кампании не кэшируются. Backend requirements пока задают диапазоны версий.

Локальная проверка workflow: actionlint 1.7.7, `server/.venv/bin/python -m unittest
discover -s scripts/tests -v`. Контрактные тесты проверяют покрытие всех suites
матрицей, количество тестов, pins Actions и цепочку Windows candidate.
Локальные результаты не заменяют настоящий запуск GitHub Actions.

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

Для ручной проверки кандидата: Actions -> Windows release -> Run workflow:

- workflow branch: master после merge; до merge — ветка с новой конфигурацией CI;
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

Локальная Cloud Environment работает на Linux. Windows ZIP/startup/smoke проверены на GitHub Windows runner для указанного ниже candidate; интерактивный launcher и Porthole остаются ручными проверками. Зависимости Python пока имеют диапазоны; каждый кандидат заново устанавливает их и проверяет собранный пакет. Полного побитового воспроизведения между датами/платформами не обещаем.


## Подготовка PR и защита master

Временный push-триггер Windows candidate для рабочей ветки удалён. Обычный push
в любую ветку и события PR не запускают Windows release. Сохранены теги `v*` и
ручной workflow_dispatch. Для candidate выбирайте publish=false и пустой release_tag.
До merge выбирайте workflow branch `ci/restore-pipeline-optimization`, чтобы
использовать новую конфигурацию Full CI; candidate_ref задавайте полным SHA.

Для PR из рабочей ветки в master проверьте Full CI: backend, frontend,
четыре browser-группы и CI required. PR должен быть готовым к review (не draft).
Сверьте refs/pull/<number>/merge с SHA resolve/checkout и tested_sha успешного gate,
а его родителей — с актуальными head/base. После изменения head/base нужен новый
полный прогон; старые результаты кандидата не подтверждают новый merge-коммит.
Windows release и publish на событии PR должны отсутствовать.

Для master настройте Branch Protection или активный Ruleset:

- Require a pull request before merging.
- Require status checks to pass: `CI required` из Full CI, источник GitHub Actions.
  Выберите точное имя контекста после появления проверки на PR; не подставляйте
  `checks / CI required` из reusable Windows candidate. Gate уже требует backend,
  frontend и все четыре Chromium-группы; Fast CI его не заменяет.
- Require branches to be up to date before merging (strict required checks).
- Запретить force-push и удаление master; исключить обход обязательного PR/gate,
  в том числе административный bypass.

Для единственного владельца не задавайте обязательный чужой approval без
доступного reviewer. Merge queue не включайте без добавления события merge_group
в workflow. Настройки защиты в рамках этой подготовки не изменяются.

Проверенный Windows candidate: [run 41454906403](https://github.com/LunierVeil/Laterna-VTT/actions/runs/41454906403),
SHA e95f9d19b3ea43b33fc63fc4ba4094d255738ae7: Full CI и Windows ZIP smoke успешны,
publish пропущен. Этот результат не заменяет проверку будущего merge-коммита PR.
