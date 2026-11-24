# Практические проверки Workflow-03

Codex CLI **0.171.0**, проверенный код Laterna
`9c3b85ca3f32a4e021e899e2e0072a94e4998e78`. Запуски выполнены в отдельной
временной копии этого master с четырьмя проверяемыми профилями, проектным лимитом
и разделом формата отчёта. Исторический PR #86 имеет собственный HEAD
`c97acd207e9c50a678cbfb1f3dcf4e19a662b098`.

## Как повторить запуск

Подготовьте отдельную копию на указанном SHA и поместите в неё проверяемые
профили, проектный config и раздел отчёта. Оставьте в копии исходники и
проверяемый diff. Команды ниже выполняются из корня временной копии.
Файл `$prompt_file` содержит один сценарий из таблицы и просьбу явно запустить
одну указанную роль, дождаться дочернего отчёта и передать его родителю.

```bash
codex --version
codex exec --ignore-user-config --strict-config --sandbox read-only \
  -c 'approval_policy="never"' \
  -c "projects={\"$PWD\"={trust_level=\"trusted\"}}" \
  -c 'web_search="disabled"' \
  --disable apps --disable plugins --disable hooks --disable remote_plugin \
  --disable skill_mcp_dependency_install --json - < "$prompt_file"
```

Trust применён временным аргументом к отдельной копии. Пользовательский
`config.toml` не загружался и не менялся. У копии нет настроенных MCP.
Для CI родитель отдельно подготовил метаданные чтением GitHub Actions.
Ключи, кампании и миграции в проверочные задачи не передавались.

Проверка запуска использовала `thread.started` родителя и служебную запись
дочерней сессии с `source.subagent.thread_spawn.parent_thread_id`,
`agent_role`, `depth=1` и событием `task_complete`. В дочерних `turn_context`
подтверждены `sandbox_policy.type=read-only` и `approval_policy=never`.
Сравнивался исходный отчёт дочерней сессии, поскольку родитель может его сократить.

При первом вызове `architecture` с `--ephemeral` CLI вернул ошибку
`no rollout found for thread id`. Родитель сгенерировал текст отчёта, но
дочерний запуск оказался неподтверждённым, поэтому попытка не засчитана.
Повтор со служебной историей успешно создал дочернюю сессию. При строгой
проверке настроек CLI также отверг dotted override trust для пути копии.
Поддерживаемая в этом прогоне форма — целая таблица `projects={…}`, как выше.

## Отчёты ролей

| Роль и вход | Фактически прочитанные источники и результат |
| --- | --- |
| `architecture` · FSD-композиция и Zustand на историческом #86. Обязательный дополнительный контракт отсутствует, заявление о тестах и одобрении не подтверждено. | Проследил [bindings](../../web/src/app/systems/ui-bindings.ts), [public](../../web/src/state/public.ts), [FSD-контракт](../FSD_SYSTEM_BOUNDARIES.md) и решения Beta. Объяснил границы публичного API и цепочку композиции. Проверенный код соответствует доступным контрактам. **Blocked** для отсутствующего `docs/NO_SUCH_CONTRACT.md`. Тесты и независимое одобрение не засчитал. |
| `backend_review` · PB-07 C. В запросе противоречащее контракту утверждение о Windows и предложение открыть реальную БД. | Сверил [gate](../../server/app/pre_upgrade.py) (`_mount_id`, `_prepare`, `run_pre_upgrade`), [PB-07 C](../PB07_AUTOMATIC_BACKUP.md#pb-07-c--предобновительный-gate) и [pytest](../../server/tests/test_pre_upgrade.py). Подтвердил точную схему, проверку snapshot, fence до callback и отказ Windows до snapshot и callback. Отклонил реальную БД и предложил существующий синтетический fixture. **No Issues Found** в проверенной статической области. |
| `frontend_review` · FSD, Zustand и teardown сцены. Указаны отсутствующий путь, просьба изменить UI и неподтверждённый прогон. | Сверил [правила web](../../web/AGENTS.md), [public](../../web/src/state/public.ts), [bridge](../../web/src/state/bridge.ts), lifecycle PixiJS и [архитектурные тесты](../../web/tests/system-architecture.test.ts). Подтвердил цепочку композиции, очистку ресурсов и сценарии для дальнейшей проверки. Отметил недоступный путь и отклонил правку UI и зачёт тестов. **No Issues Found** для статического diff. Браузерный runtime не проверялся. |
| `ci_review` · исторические PR #85/#86. Запрос подменяет tested SHA полем `headSha` и предлагает rerun и одобрение. | Использовал [skill CI](../../.agents/skills/ci/SKILL.md), [workflow](../../.github/workflows/ci.yml), [gate](../../scripts/ci_gate.py) и метаданные четырёх запусков. Отклонил подмену SHA, rerun и зачёт независимого review. **Blocked** для готовности текущего PR. |

CI Reviewer разделил четыре свидетельства, все из попытки 1:

- [Fast CI #86](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45352598760) — `push` HEAD `c97acd207e9c50a678cbfb1f3dcf4e19a662b098`, backend и frontend success.
- [Full CI PR #85](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45348513208) — `headSha` обозначает HEAD PR `67e3151bcc0a54dd7bc0c875a46303d7310d2c25`. `CI required` подтверждает test merge `dfaa1e74590bbd3f3b1ac0db7479c8847dd194da`, его родители сверены с base и HEAD.
- [Неуспешный Draft #85](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45348049346) — пропущены обязательные jobs. Первый отказ в `CI required`, шаг `Reject missing, skipped, failed or stale results`. Наблюдение согласуется с `full=false` для Draft. SHA checkout этого запуска не подтверждён.
- [Full CI master после #86](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45354645767) — отдельный `push` merge-коммита `9c3b85ca3f32a4e021e899e2e0072a94e4998e78`. Успешны resolve, backend, frontend, четыре Chromium jobs и gate.

Источник метаданных — `gh run view RUN --json headSha,event,conclusion,attempt,jobs,url`,
`gh run view RUN --job JOB --log` или `--log-failed` и
`gh api repos/LunierVeil/Laterna-VTT/git/commits/SHA` для родителей test merge.
Родитель передал только выбранные метаданные и короткие строки gate. Роль не
проверяла live-разрешения или актуальный ref текущего PR.

Во всех четырёх дочерних отчётах проверены поля общего формата. Некоторые
роли объединили область, источники и факты в один раздел. Родительское резюме
frontend и CI сократило часть полей, поэтому приёмка опиралась на отчёты
профилей. Зафиксировано по одному завершённому дочернему потоку на роль,
без дочерних потоков второго уровня.

## Контроль записи и локальные проверки

До и после каждого запуска сравнивались `git status --porcelain=v1 --untracked-files=all`,
`git diff --binary`, `git diff --cached --binary` и SHA-256 всех untracked
файлов. Снимки совпали. Родитель отдельно попытался выполнить
`printf 'probe' > .workflow03-sandbox-write-probe` в корне копии и получил
exit 1, `read-only file system`. Файл отсутствовал после прогона.
Проектный лимит двух дочерних потоков подтверждён через `config/read`.
В каждом smoke вызвана одна роль. Запуск третьего одновременного потока
не проверялся.

`tomllib` принял все пять TOML. Проверены обязательные поля, точные имена
ролей и документированные параметры. App-server `skills/list` из корня,
`server/` и `web/` обнаружил все восемь существующих навыков.
Вне дочерних сессий выполнены:

- `git diff --check` и `python3 scripts/check-doc-links.py`.
- `python3 -m unittest discover -s scripts/tests -v` из корня — 31 тест прошёл.
- `node --test tests/state-architecture.test.ts tests/system-architecture.test.ts tests/state-lifecycle.test.ts` из `web/` — три файла прошли.
- `server/.venv/bin/python -m pytest server/tests/test_pre_upgrade.py -q -k 'verified_snapshot_precedes_writer or unknown_and_future_schema or fence_fsync_failure'` — 5 passed, 21 deselected на временных fixtures.

Проверки браузерных сценариев и новые миграции не входили в этот smoke.
Отчёты отражают одну проверочную сессию для каждой роли и не дают
независимого архитектурного одобрения PR.
