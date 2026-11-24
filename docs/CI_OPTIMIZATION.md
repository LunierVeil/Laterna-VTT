# Оптимизация CI Laterna VTT

Baseline master — `2aaef8efca4836d117106a77067862a5219edf77`. Цель — укоротить
Full CI, сохранив Fast CI на push HEAD, тесты и тайм-ауты, отдельные временные
данные, защиту master и [контракт CI required](CI_CD.md#fast-ci-и-full-ci).

## Измерение baseline

Выборка — 10 последних сопоставимых успешных Full CI с исходной матрицей и
первой попыткой. Включены push master и готовые PR. Draft, ручные и reusable
runs исключены. Например, [45343060706](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45343060706)
включает повторную попытку и непоказателен для этого сравнения.
Результаты характеризуют успешные запуски. По ним нельзя оценить частоту отказов.

Wall — `updated_at − created_at` запуска. Ожидание первого runner —
`resolve.started_at − created_at` (включает диспетчеризацию). Runner time —
сумма `completed_at − started_at` jobs одной попытки. Издержки округления
GitHub и фактическое списание минут в эту сумму не входят. Step time берётся
из тех же timestamps соответствующего шага. Все времена в секундах.

| Full CI | Событие | Wall | Ожидание первого job | Runner time | Tokens: HTTP / обычная группа |
| --- | --- | ---: | ---: | ---: | ---: |
| [45414919043](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45414919043) | push | 387 | 2 | 1230 | 166 / 151 |
| [45413560096](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45413560096) | PR | 385 | 3 | 1155 | 164 / 152 |
| [45396070093](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45396070093) | push | 394 | 3 | 1265 | 168 / 152 |
| [45394681035](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45394681035) | PR | 380 | 3 | 1163 | 163 / 149 |
| [45359616686](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45359616686) | push | 401 | 3 | 1330 | 166 / 152 |
| [45358175446](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45358175446) | PR | 491 | 2 | 1342 | 96 / 87 |
| [45354645767](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45354645767) | push | 377 | 3 | 1388 | 161 / 147 |
| [45353299935](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45353299935) | PR | 375 | 2 | 1182 | 165 / 150 |
| [45349674468](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45349674468) | push | 567 | 3 | 1524 | 94 / 85 |
| [45348513208](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45348513208) | PR | 389 | 3 | 1226 | 171 / 155 |
| Медиана | | 388 | 3 | 1247,5 (20,79 мин) | 164,5 / 150,5 |

Tokens был самым долгим job в 10 из 10 запусков, медиана 366,5 с. В baseline
master последовательные HTTP и обычные тесты занимали 317 из 368 с Tokens.
Ниже — фактические интервалы jobs и выбранных шагов этого запуска.

| Job | Исполнение, с | Шаги, с |
| --- | ---: | --- |
| resolve | 5 | checkout 1 |
| backend | 118 | setup Python 4, pip 9, служебные тесты 3, pytest 95 |
| frontend | 32 | setup Node 5, npm ci 5, typecheck 3, unit 3, build 8 |
| browser (sheets) | 262 | Chromium install 17, тесты и evidence 220 |
| browser (tokens) | 368 | venv/pip 11, npm ci 5, Chromium install 20, HTTP 166, обычные тесты и evidence 151 |
| browser (scenes) | 214 | Chromium install 34, тесты и evidence 147 |
| browser (interaction) | 225 | Chromium install 21, тесты и evidence 175 |
| CI required | 6 | download <1 по округлению метаданных, gate 1 |

В Tokens restore 32 МБ pip и 53 МБ npm занял примерно по 1,5–2 с по отметкам
лога. На первичных ключах оба cache hit, save не выполнялся. Ключи setup
actions учитывают платформу и хэш requirements/lockfile, pip также версию
Python. Cache miss, стоимость записи и время Playwright cache hit здесь не
измерены. Кэш Playwright всё равно оставил бы установку системных зависимостей.
Для крупных кэшей venv/node_modules пока нет основания. Артефакты evidence остаются
изолированными по run и попытке.

## Выбор конфигурации Chromium

По JUnit длительность отдельных suites на baseline master без части накладных
расходов составила 193,7 с для sheets, 25,1 с для sheet-lifecycle, 130,8 с для
tokens, 18,9 с для network, 85,8 с для scenes, 60,1 с для auth, 86,6 с для
chat-dice, 21,8 с для ui, 3,5 с для smoke, 4,6 с для design-system, 7,7 с
для components-v03, 21,5 с для initiative и 25,0 с для catalog.
Среди длинных отдельных случаев — auth 60,1 с, dice 53,2 с,
адаптивный лист PC 46,6. Порядок случаев внутри каждого файла сохранён.

| Вариант | Прогноз критического browser job на baseline master | Цена и ограничение |
| --- | --- | --- |
| Исходные четыре runners | 368 с (измерено) | Два последовательных набора в Tokens |
| Четыре, только перераспределение suites | 213 с тестов + 42–67 с типовых накладных расходов | Нужны более широкие перестановки и отдельный HTTP-отчёт внутри одной из групп |
| Пять, отдельный HTTP, прежние обычные группы | 262 с (прогноз по Sheets) | Один дополнительный browser setup |
| Пять, отдельный HTTP и перенос sheet-lifecycle в Tokens | Около 237 с (262 − 25) | Принято. Один дополнительный setup, перенос одного целого файла |

Модель для четырёх runners минимизирует максимальную сумму неделимых
suite по JUnit с HTTP как неделимым блоком. Раскладка даёт 213,2 с
на длиннейшем runner против нижней границы 212,8 с по сумме работы. Время
сборки fixtures и запуска jobs взято приближённо из baseline и может
меняться. При пяти jobs перенос одного файла снижает прогнозируемый
максимум. Дополнительный setup стоит ориентировочно 0,7–1,1 runner-минуты.

Новая цепочка — resolve → backend, frontend и пять browser jobs → CI required.
Runner передаёт существующий `http-uuid.mjs` в Node test runner с JUnit. Его
импорты, LAN HTTP, авторизация, reconnect и UI assertions сохранены. HTTP
группа использует отдельный runner, а HTTP harness сохраняет прежнюю
структуру. Обычные suites по-прежнему используют отдельные API, Vite, SQLite,
uploads, ключи и Chromium contexts. Сбор диагностики и startup timings
сохранён. HTTP получает собственный каталог.

Gate требует 38 обычных и 8 HTTP testcase в пяти отчётах, проверяет
повторные testcase, неполные или повторные группы, неуспешные обязательные
jobs, точные SHA, run ID и attempt. Draft, устаревшие head/base/test merge,
неверный candidate и ошибки GitHub API остаются блокирующими.
Контрактные тесты проверяют единственность каждой обычной suite и оба импорта
HTTP. Содержание файлов сценариев и production-код не изменены.

## Остальные решения

- **Fast CI.** Восемь успешных исторических push runs заняли 90–119 с,
  медиана 98 с. Push всегда проверяет точный HEAD рабочей ветки. При
  opened/reopened/synchronize/converted_to_draft Draft дополнительно проверяет
  test merge. Ready пропускает jobs Fast CI на PR и получает Full CI на
  ready_for_review. Push в Ready-ветку даёт Fast CI HEAD и синхронизацию Full CI
  test merge. Один и тот же HEAD с разными base не эквивалентен test merge.
  Отмена работает отдельно по ветке и номеру PR. Триггеры сохранены.
  Typecheck повторяется внутри канонического `npm run build`. В Full CI
  frontend это примерно 3 с, а критический путь Fast CI
  обычно проходит через backend.
- **Браузерная среда.** Vite запускается в dev-режиме, suites не повторяют
  production build. При опросе готовности у каждого API и Vite свои порты
  и настройки прокси. Общий mutable fixture нарушил бы проверяемую изоляцию,
  а копия production build меняет режим
  тестирования. Тайм-ауты, ожидания и сбор диагностики сохранены.
- **Backend.** Локальный `pytest server/tests -q --durations=25` на Python
  3.14 дал 762 passed, 1 skipped за 65,52 с. Самый длинный вызов — ожидаемый
  WS heartbeat 15,02 с. Live storage lock занял 2,54 с, CLI backup/restore —
  2,09 с, live automatic backup — 1,78 с, crash/retry pre-upgrade (writer) —
  0,65 с. Верх профиля занят вызовами тестов, а не fixture setup/teardown.
  `conftest.py` задаёт временные пути и process-global env до импорта
  приложения. Часть тестов запускает реальные серверы и процессы,
  проверяет конкуренцию за хранилище и повторный startup. До xdist нужен
  аудит отдельных файловых путей, портов, env, module-global state и
  блокировок по worker. Backend короче измеренного browser path.
- **Параллельные PR.** Full CI использует номер PR, для push — ref.
  Независимые номера и ветки не взаимно отменяются. Для Windows reusable
  используется имя workflow вызывающей стороны и кандидат. Артефакты
  изолированы запуском, а evidence дополнительно именуется по run, attempt и
  группе. Общие кэши содержат пакеты, без тестовых результатов или данных
  кампании. После изменения base нужен свежий test merge и gate. При 2–4
  одновременных Full CI возможен рост очереди из-за пятого runner. Нагрузочный
  прогон нескольких PR не выполнялся.
- **Windows.** Цепочка candidate → reusable Full CI → package → publish
  использует обновлённую матрицу через тот же `tested_sha`. Packaging сверяет
  candidate, tested и checkout, передаёт SHA в `SOURCE_COMMIT.txt`.
  При ручном smoke обязательны точный SHA, `publish=false` и пустой тег.
  Workflow публикации и политика master сохранены.

## Проверка кандидата

Контрольный запуск на точном SHA ветки измеряется отдельно от Full CI
готового PR. Full CI готового PR остаётся частью процедуры после независимого
review. Сравнение benchmark с baseline наблюдательное. Тип события, runner,
кэш и нагрузка могут различаться. Для поведения и инвентаря используются
локальные проверки, а скорость измеряется на GitHub runners.

[Ручной Full CI](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45418152143)
на `09d980bf84f71e19664dbf034188d6c260370529` прошёл с первой попытки.
Ниже — результат рядом с медианой десяти запусков и последним исходным
Full CI master. Время указано в секундах, кроме строки runner-минут.

| Метрика | Медиана baseline | Baseline master | Benchmark |
| --- | ---: | ---: | ---: |
| Full CI wall | 388 | 387 | 257 |
| До старта resolve | 3 | 2 | 4 |
| Самый долгий browser job | 366,5 | 368 | 240 |
| Все jobs, runner-минуты | 20,79 | 20,50 | 20,30 |
| Обычные testcase / HTTP testcase | 38 / 8 | 38 / 8 | 38 / 8 |

Benchmark занял на 131 с (33,8%) меньше медианы baseline и попал в целевые
210–270 с. Сумма runner time в этом запуске на 0,49 минуты ниже медианы.
Пятый job добавляет один setup и может увеличить потребление на другом
runner. Одного наблюдения мало для вывода о долгосрочном снижении стоимости
или о времени полного цикла PR.

| Job | Baseline master, с | Benchmark, с | Шаги benchmark, с |
| --- | ---: | ---: | --- |
| resolve | 5 | 4 | checkout 1 |
| backend | 118 | 95 | pip 6, служебные тесты 3, pytest 78 |
| frontend | 32 | 24 | npm ci 3, typecheck 3, unit 3, build 6 |
| browser (sheets) | 262 | 240 | Chromium 17, тесты/evidence 199 |
| browser (tokens) | 368 | 231 | Chromium 19, тесты/evidence 178 |
| browser (scenes) | 214 | 228 | Chromium 32, тесты/evidence 154 |
| browser (interaction) | 225 | 240 | Chromium 17, тесты/evidence 201 |
| browser (http-uuid) | — | 151 | setup Python/Node 2/5, venv/pip 9, npm ci 4, Chromium 18, тесты/evidence 106 |
| CI required | 6 | 5 | скачивание пяти evidence 1 |

Все пять browser jobs стартовали через 2 с после завершения resolve.
Upload диагностики занял 1–2 с на группу, upload evidence — 1 с.
В новом HTTP job оба cache hit, интервалы от cache hit до restored
составили 1,1–1,4 с. На первичных ключах сохранение снова пропущено.
Идентичность 38 обычных и восьми HTTP случаев сверена по JUnit GitHub,
а все пять evidence содержат SHA кандидата, run `45418152143`, attempt `1`
и соответствующие counts. Лог gate подтвердил тот же SHA.

[Fast CI кандидата](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45418130936)
по push занял 119 с при runner time 150 с. Backend занял 116 с, включая
99 с pytest, а frontend — 34 с. Цель 45–90 с в этом наблюдении не достигнута.
Этот замер относится к SHA реализации.

[Windows candidate smoke](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45418187901)
на том же SHA прошёл с первой попытки, с `publish=false` и пустым тегом.
Все пять jobs Chromium и `checks / CI required` прошли в reusable Full CI.
Шаг проверки candidate/tested/checkout и запуск извлечённого пакета прошли,
`publish` пропущен. В скачанном ZIP `SOURCE_COMMIT.txt` совпадает с SHA
кандидата, SHA-256 совпадает с контрольной суммой артефакта. В этом запуске
Interaction занял 306 с. Разница с 240 с самостоятельного benchmark показывает
вариативность runner time. Этот Windows run измерял совместимость, а не
время типового PR.

Локально прошли `actionlint` 1.7.12, 45 служебных unittest, проверка Markdown
и `git diff --check`. Для frontend прошли typecheck, 25 frontend unit-проверок и
production build. Изолированные браузерные проверки выполнены с Chromium
из Playwright 1.64.1. Все пять JUnit приняты генератором evidence.
Мультимножество пар «файл, имя testcase» совпало с baseline для 38 обычных
случаев. Восемь случаев HTTP совпали с обычными catalog и tokens, которые
импортирует неизменённый HTTP harness.

В TDD RED тест на обязательность HTTP evidence упал из-за отсутствия
группы, а отдельный RED принял JUnit с повтором testcase взамен
отсутствующего. Оба затем прошли. Негативные проверки также покрывают
failed/cancelled/skipped jobs, missing/duplicate/unknown группы, неполный
JUnit, SHA/run/attempt, draft, смену head/base/test merge и ошибку API.
