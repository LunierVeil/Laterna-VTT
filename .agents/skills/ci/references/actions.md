# Проверка GitHub Actions Laterna VTT

Команды выполняются из корня с GitHub CLI и доступом на чтение. При отсутствии
доступа укажи непроверенные поля. Для исторической диагностики отделяй состояние
на момент запуска от текущей готовности. В командах ниже подставь полученные
SHA, номера PR, run и attempt.

## Fast CI рабочего HEAD

Сверь локальную ветку и полный HEAD с удалённой веткой и HEAD PR, если PR открыт.

```bash
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
branch=$(git branch --show-current)
head=$(git rev-parse HEAD)
git ls-remote origin "refs/heads/$branch"
gh run list --workflow fast-ci.yml --branch "$branch" --commit "$head" --event push \
  --json databaseId,headBranch,headSha,event,status,conclusion,url
gh run view "$run_id" --json attempt,event,headSha,status,conclusion,jobs,url
```

Нужен завершённый успешный push-run на точной ветке и SHA с успешными
`backend` и `frontend` в выбранной попытке. Список jobs этой попытки даёт
`gh api "repos/$repo/actions/runs/$run_id/attempts/$attempt/jobs" --paginate`. Запуск на `pull_request`
использует PR test merge в checkout и не подтверждает push HEAD. Пустой список,
очередь и частичный результат оставляют Fast CI неподтверждённым.

## Full CI открытого PR

```bash
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
gh api "repos/$repo/pulls/$pr_number" \
  --jq '{state,draft,head:.head.sha,base:.base.sha,base_ref:.base.ref,merge_commit_sha,mergeable}'
git ls-remote origin "refs/heads/$base_ref" "refs/pull/$pr_number/merge"
gh run list --workflow ci.yml --event pull_request --commit "$pr_head" \
  --json databaseId,event,headSha,status,conclusion,url
gh run view "$run_id" --json attempt,event,headSha,status,conclusion,jobs,url
```

- PR должен быть открыт, в Ready и без конфликта. Если `mergeable` ещё
  вычисляется или merge ref отсутствует, повтори чтение после расчёта GitHub.
  Сверь текущий base ref с base SHA, API `merge_commit_sha` с test-merge ref
  и оба родителя test merge с base и HEAD. Родителей можно прочитать через
  `gh api "repos/$repo/git/commits/$merge_sha" --jq '.parents[].sha'`.
- Сопоставь run с номером PR по странице Actions или полю `pull_requests` API
  запуска. При пустом поле сверяй событие, HEAD, base и SHA test merge. Поле `headSha` списка run для события
  `pull_request` может содержать HEAD PR. Проверенный коммит бери из строки
  `Full CI passed for …` успешного job `CI required` или из свидетельств
  `chromium-evidence-<run>-<attempt>-<group>`. Сверь его с текущим test merge.
- В одной и той же попытке требуются `resolve`, `backend`, `frontend`,
  `browser (sheets)`, `browser (tokens)`, `browser (scenes)`,
  `browser (interaction)` и `CI required`, все со статусом success.
  Для точной попытки используй
  `gh api "repos/$repo/actions/runs/$run_id/attempts/$attempt/jobs" --paginate`.
  Сверь Run ID, attempt и SHA с [проверкой gate](../../../../scripts/ci_gate.py).
  Перед выводом обнови состояние PR. Любое расхождение HEAD/base/test merge,
  отсутствие доказательств или смена стадии оставляет merge неподтверждённым.

## Full CI нового master

Прочитай текущий `refs/heads/master` через `git ls-remote`. Найди Full CI по
`gh run list --workflow ci.yml --branch master --event push --commit "$master_sha"`.
Примени тот же набор jobs и считай доказанным текущий master только если
проверенный SHA совпадает с удалённым ref при повторной сверке. Для закрытого
PR `merge_commit_sha` может обозначать итог объединения. Исторический PR run
и push merge-коммита проверяются отдельно.

## Диагностика

Возьми job ID выбранной попытки. `gh run view "$run_id" --attempt "$attempt" --job "$job_id" --log-failed`
даёт лог упавших шагов. Для успешной строки gate используй `--log` вместо
`--log-failed`. Ищи первый причинный шаг. Последующие `skipped` отмечай как
следствие. Различай падение теста, compilation/typecheck, сбой runner или сети,
тайм-аут, нехватку памяти или диска, конфликт/stale SHA и ожидаемую блокировку
Draft. Flaky — гипотеза до сравнения одинаковых условий и исходников.
Скрывай секреты и пользовательские данные в цитатах.

Выбери минимальную команду воспроизведения из [DEVELOPMENT](../../../../docs/DEVELOPMENT.md#все-проверки)
или укажи, почему причина проверяема только на runner. Для Full CI допустим
обоснованный ограниченный повтор всех jobs, поскольку частичный rerun не даёт
новой полной попытки. Сохрани первоначальный результат. Изменения защиты,
assertions, counts и тайм-аутов не являются действиями диагностики.
