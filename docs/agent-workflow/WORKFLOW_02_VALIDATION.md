# Практические проверки Workflow-02

Проверки выполнены на рабочем дереве от `8377c96b28dbeb8a1612665d0bc1f45cda253ce4`
с изменениями навыков и документации Workflow-02. Процедуры применены вручную
в сессии Codex, с действительными командами и результатами. Codex CLI 0.171.0
отдельно подтвердил обнаружение всех восьми навыков через локальный
`codex app-server --listen stdio://` и `skills/list` из корня, `server/` и `web/`.
Повторяемость решений в независимых модельных сессиях остаётся предметом Workflow-05.

## Spec-First · снимок до записи

**Результат.** В разрешённом сценарии PB-07 C синхронное действие записи вызывается
под блокировками после проверенного снимка и публикации маркера. Вход — существующая
файловая SQLite известной схемы в одном DataHome, с uploads и файловым ключом.
Затронуты [gate](../../server/app/pre_upgrade.py) и PB-06 backup/restore. Публичные
API, события и frontend остаются вне задачи. Файловая долговечность и отказ до
вызова writer — требования [контракта PB-07 C](../PB07_AUTOMATIC_BACKUP.md#pb-07-c--предобновительный-gate).

| Критерий | Проверка в `test_pre_upgrade.py` | Результат |
| --- | --- | --- |
| Writer получает проверенный снимок и видит маркер. Restore в отдельный DataHome возвращает исходные данные. | `test_verified_snapshot_precedes_writer_and_can_restore` | Прошла. |
| Неизвестная схема и повреждение снимка исключают вызов writer. | `test_unknown_and_future_schema_fails_closed`, `test_tampering_blocks_writer` | Прошли все параметры. |
| При ошибке синхронизации каталога маркера writer не вызывается, исходные данные сохраняются, повтор блокируется. | `test_fence_fsync_failure_preserves_source_and_prevents_retry` | Прошла. |

```bash
server/.venv/bin/python -m pytest server/tests/test_pre_upgrade.py -q \
  -k 'verified_snapshot_precedes_writer or unknown_and_future_schema or tampering_blocks_writer or fence_fsync_failure'
```

9 passed, 17 deselected. OPEN остаются Alembic, адаптеры Alpha, финализация,
recovery и Windows upgrade. Предложение запустить миграцию с OPEN-решением или
без разрешения на данные останавливается до записи.

## TDD · точное число Chromium-сценариев

Исторический сценарий группы `sheets`. В изолированный временный каталог
сохранён исторический gate командой
`git show 6d8a9fb89e87c4b2a303115d8cb944fe78688efc:scripts/ci_gate.py > "$scratch/ci_gate.py"`.
До изменений в нём создан `test_sheets_evidence.py`. Тест передаёт в
`browser_evidence('sheets', 'a' * 40, '123', '1', report)` два JUnit-отчёта.
Отчёт `<testsuite>` содержит 8 или 9 успешных `<testcase name="sheet"/>`.
Критерий требует `ValueError` с числом 8 для первого и `passed == 9` для второго.

| Фаза | Изменение во временной копии | `python3 -m unittest -v test_sheets_evidence` |
| --- | --- | --- |
| RED | Тест запущен с историческим числом 8. | Exit 1. Отчёт из 8 принят, из 9 отклонён. Ошибка соответствует тестируемому контракту. |
| GREEN | В `GROUP_COUNTS` только `sheets` изменён с 8 на 9. | 1 passed. |
| REFACTOR | В `browser_evidence` число случаев вычислено один раз и переиспользовано в проверке и результате. | 1 passed, содержимое теста совпало во всех фазах. |

После REFACTOR в той же копии прошли новый тест и три существующие регрессии из
[test_ci_gate.py](../../scripts/tests/test_ci_gate.py). Они проверяют пропуски,
устаревшие артефакты, failed/skipped/cancelled jobs и Fast/Draft без допуска к gate.
Рабочая ветка содержит только документацию и инструкции, временный тест и
исторический код остаются вне Git.

## QA · запуск и блокировки DataHome

| Риск | Конкретный сценарий | Доказательство |
| --- | --- | --- |
| Перезапись существующего экземпляра | Первый запуск создаёт хранилище. Повторный запуск сохраняет БД, uploads и ключ. | `test_first_run_then_existing_database_and_assets_preserved`. |
| Подмена или потеря части комплекта | Preflight отклоняет неполный или ошибочный набор. Исчезнувшая БД не пересоздаётся. | `test_bad_existing_state_is_unchanged`, `test_engine_prevents_implicit_creation_when_database_disappears`. |
| Гонка и конфликт владельцев | Один процесс получает право первого запуска. Конфликтующий процесс отклонён, независимый DataHome доступен. | `test_concurrent_first_start_has_one_owner`, `test_live_owner_blocks_overrides_and_independent_home_can_listen`. |
| Запрос на реальные данные или чужой артефакт без доступа | Не открывать и не копировать источник. Воспроизвести на синтетической копии приложения и временной БД. | Ручной отрицательный сценарий по маршруту QA. Фактические тесты используют `tmp_path` и отдельные процессы. |

```bash
server/.venv/bin/python -m pytest server/tests/test_storage_preflight.py server/tests/test_storage_lock.py -q
```

Первый запуск в sandbox дал 18 pass и 5 startup timeout. Повтор с разрешённым
loopback дал 23 pass за 14.39 с. Результаты разделены, сбой первого запуска
не записан как исправленная регрессия. В проверенных сценариях блока DataHome
по повторному прогону дефекты не выявлены. Матрица не покрывает Windows,
Chromium и отдельный приёмочный сценарий PB-08.

Дополнительно из `web/` прошли три файла защиты архитектурных границ и lifecycle:
`node --test tests/state-lifecycle.test.ts tests/state-architecture.test.ts tests/system-architecture.test.ts`.

## CI · проверка SHA и отрицательные сценарии

| Сценарий | Фактический результат |
| --- | --- |
| [Fast CI push Workflow-01](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45348042673) | Push HEAD `67e3151bcc0a54dd7bc0c875a46303d7310d2c25`, backend и frontend success. Для другого HEAD это устаревшее свидетельство. |
| [Full CI PR #85](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45348513208) | Поле API `head_sha` вернуло `67e3151…`. Job `CI required` подтвердил test merge `dfaa1e74590bbd3f3b1ac0db7479c8847dd194da`. В попытке 1 успешны resolve, backend, frontend, четыре Chromium и gate. Родители test merge — base `273564a…` и HEAD `67e3151…`. |
| [Неуспешный Full CI PR #85](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45348049346) | В job `CI required` на шаге `Reject missing, skipped, failed or stale results` получено `Required job failed, skipped or cancelled`. Пропуск обязательных jobs соответствует состоянию Draft. Причина подтверждается [workflow](../../.github/workflows/ci.yml) и тестом `test_fast_draft_or_wrong_job_sha_cannot_satisfy_gate`. Для перехода к Full CI требуется действующий порядок review и Ready. Rerun Draft причину не устраняет. |
| [Full CI нового master после PR #85](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45349674468) | Успешный push для `8377c96b28dbeb8a1612665d0bc1f45cda253ce4`, все обязательные jobs success. Это отдельное доказательство от PR test merge. |
| Нет CI на указанной ветке и SHA | Чтение `gh run list --workflow fast-ci.yml --branch codex/workflow-02 --event push --commit 8377c96b28dbeb8a1612665d0bc1f45cda253ce4` до публикации вернуло пустой список. Fast CI не подтверждён. |
| Устаревший HEAD, изменившийся base или недоступный API | Существующие `test_pr_head_base_merge_draft_and_state_must_remain_current` и `test_obsolete_push_fails_and_api_errors_propagate` подтвердили закрытый gate в каждом случае. |
| Нет независимого review точного HEAD или полномочий | При ручном разборе успешный Fast CI и одобрение другого SHA оставляют Ready и merge недоступными. Вызовы на изменение PR, защиту и rerun не выполнялись. |

Команды для повторения разбора даны в [справке навыка](../../.agents/skills/ci/references/actions.md).
Для первых четырёх случаев использованы метаданные `gh run view`, jobs конкретной
попытки через `gh api`, строки `CI required` и родители test merge через GitHub API.

## Локальные проверки содержимого

`git diff --check`, `python3 scripts/check-doc-links.py` и
`python3 -m unittest discover -s scripts/tests -v`. Служебные тесты — 31 passed.
Валидатор `quick_validate.py` из skill-creator принял все четыре новых навыка.
Ссылки и границы файлов проверены перед коммитом.
