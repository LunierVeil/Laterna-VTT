# Оптимизация CI Laterna VTT · Phase 2

Base `fa02170ca7e2457c5e24853b85bff8b341540f42`. PR #90 влит и [Full CI этого
master](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45570515805) прошёл.
Phase 0 означает десять сопоставимых первых попыток из [отчёта Phase 1](CI_OPTIMIZATION.md).
Ниже wall time означает интервал создания до завершения workflow, runner time —
сумму интервалов исполнения jobs одной попытки. В runner time не входят
округление биллинга и очередь.

| Срез | Full CI wall, с | Длиннейший browser job, с | Backend, с | Runner-минуты |
| --- | ---: | ---: | ---: | ---: |
| Phase 0, медиана 10 запусков | 388 | 366,5 | 95–120 | 20,79 |
| [Phase 1, ручной benchmark](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45418152143) | 257 | 240 | 95 | 20,30 |
| [Phase 1, test merge PR #90](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45569852805) | 278 | 257 | 112 | 20,23 |
| [Phase 1, push master](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45570515805) | 245 | 226 | 114 | 17,62 |

Fast CI Phase 0 — медиана 98 с. [Fast CI Phase 1 exact push](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45420229443)
занял 122 с, backend 120 с, frontend 29 с. В [Windows reusable Phase 1](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45418187901)
Interaction занял 306 с. Эти отдельные наблюдения характеризуют разброс.

## Профиль и приоритеты

1. Full CI ждёт браузерные jobs. На Phase 1 master Scenes занял 226 с, из них
   181 с — запуск suite и evidence. На test merge Sheets занял 257 с, из них
   203 с — suite и evidence. От resolve до старта параллельных jobs прошло
   1–2 с. В тех же запусках Chromium install занимал 15–30 с на job,
   venv/pip 7–12 с, npm ci 3–5 с, setup Python 1–6 с, setup Node 1–7 с,
   runner startup 0–3 с и checkout 1–5 с по округлённым метаданным.
   Artifact upload занимал 0–2 с за шаг, скачивание evidence 1 с.
   Генерация evidence входит в тот же step, что suite.
2. Fast CI ждёт backend. В двух Full CI Phase 1 pytest занимал по 96 с из
   112–114 с job. Во frontend на ручном Phase 1 benchmark дублированный
   `tsc --noEmit` отдельно занимал 3 с. Он повторялся внутри `npm run build`.
3. Изолированный профиль исторических auth и UI на локальной машине дал
   7–11 мс для временного каталога и портов, 587–588 мс от старта FastAPI
   до ответа health (включая SQLite), ещё 16–20 мс ожидания Vite, 35–36 мс
   запуска Chromium, 7–8 мс для GM context, 445–622 мс для GM login,
   invite, клиента и player context до отправки accept. Teardown и запись
   диагностики заняли 201–209 мс. FastAPI и Vite запускаются с перекрытием.
   Отдельный CPU-вклад SQLite и полное время Vite не измерялись. На GitHub
   64 измерения старта canvas в каждом из master и PR дали медианы 938
   и 1 250 мс, максимумы 4 843 и 5 419 мс. Локальная инструментированная
   копия служит для локализации затрат и не оценивает GitHub runner.
4. Опрашиваемые browser assertions используют 50 мс между попытками.
   Лимиты heartbeat, reconnect, autoscroll и анимаций проверяют реальное
   поведение. Опрос, тайм-ауты, тестовые данные и жизненный цикл fixtures
   сохранены. Изменение fixture на общий пул сессий или mutable БД не
   оправдано измеренным вкладом запуска.

## Раскладка Chromium

Для расчёта использованы времена каждого testcase из `results.xml` в
`chromium-diagnostics-*` трёх Full CI Phase 1 выше. Для воспроизведения
скачайте артефакты через `gh run download RUN --pattern 'chromium-diagnostics-*'`
и суммируйте атрибуты `time` по `file` в элементах `testcase`. Для трёх
перенесённых случаев Sheets используйте имена B10 PC, B10 NPC и Alpha layout.
Наблюдаемые суммы по suites и режиму HTTP приведены в секундах.

| Suite | Phase 1 master | Phase 1 PR | Phase 1 dispatch |
| --- | ---: | ---: | ---: |
| sheets, оставшиеся сценарии | 48,3 | 83,8 | 81,2 |
| sheet-layout, три перенесённых | 51,0 | 118,2 | 117,0 |
| sheet-lifecycle | 15,1 | 14,2 | 22,8 |
| tokens | 88,6 | 75,1 | 131,1 |
| network | 16,0 | 14,8 | 21,8 |
| scenes | 107,3 | 107,5 | 88,8 |
| auth | 72,2 | 69,8 | 63,7 |
| chat-dice | 84,3 | 89,0 | 99,8 |
| catalog | 24,3 | 24,8 | 30,5 |
| ui | 21,0 | 20,9 | 25,7 |
| initiative | 20,1 | 20,7 | 24,2 |
| components-v03 | 7,2 | 7,3 | 8,3 |
| design-system | 4,3 | 4,2 | 5,0 |
| smoke | 2,7 | 2,8 | 3,5 |
| весь HTTP harness | 85,8 | 162,9 | 105,0 |

Перебор статических раскладок минимизировал наихудшую сумму обычных suites
среди трёх наблюдений. Порядок сценария внутри одного файла сохранён. HTTP
всегда отдельный. В оценке учитывается целая suite, а не распределение
testcase внутри runtime. Лучшие расчётные максимумы обычных групп до setup:

| Групп с HTTP | Обычный максимум, с | Пиковые параллельные jobs одного Full CI | Доп. setup против Phase 1 |
| --- | ---: | ---: | ---: |
| 5, с декомпозицией Sheets | 188,0 | 7 | 0 |
| 6 | 153,6 | 8 | 1 runner |
| 7 | 131,1 | 9 | 2 runners |
| 8 | 131,1 | 10 | 3 runners |

У семи групп обычный максимум на 22,5 с ниже шести. Восьмая не снижает
максимум, который уже ограничен неделимыми suites. Вариант с шестью остаётся
экономным при систематической очереди. Setup порядка 35–70 с на browser job
в Phase 1 означает, что два дополнительных setup могли добавить 1,2–2,3
runner-минуты. В Phase 2 ставится только закреплённый Chromium headless
shell и по-прежнему устанавливаются системные зависимости. Исходно локально
установленный полный Chromium занимал 403 МиБ, headless shell 273 МиБ и
FFmpeg 6 МиБ. Fixture и раньше запускал headless shell на CI. Локальная
проверка Phase 2 использовала только shell и FFmpeg.

B10 PC, B10 NPC и Alpha layout перенесены в отдельный файл с собственным
состоянием fixture. Условия, названия, тела и тайм-ауты трёх случаев сохранены.
Тесты Tokens и Chat/Dice оставлены цельными. Их деление увеличило бы число
запусков fixture и усложнило сравнение HTTP, а расчёт с одним разделением
уже укладывает обычную работу в разумный коридор. HTTP по-прежнему может
определить критический путь в медленном запуске.

## Backend и Fast CI

Контроль на Python 3.14 с affinity на четыре CPU, один последовательный
прогон и по два прогона `--dist loadfile` с 2 и 4 процессами.

| Workers | pytest wall, с | JUnit |
| --- | --- | --- |
| 0 | 54,12 | 762 passed, 1 skipped |
| 2 | 31,69 / 31,39 | 762 passed, 1 skipped в обоих |
| 4 | 22,94 / 23,51 | 762 passed, 1 skipped в обоих |

Во всех пяти JUnit совпали все 763 пары classname/name и статус skip
`test_real_linux_mount_and_durability`. Сбор 763 тестов занял 0,46 с
в отчёте pytest или 0,86 с от создания Python-процесса включая загрузку
плагинов и импорт. По последовательному JUnit основное время пришлось
на handlers 19,05 с, storage preflight 9,01 с, storage lock 5,20 с,
visibility 2,64 с, restore 2,41 с, automatic backup 2,28 с, backup CLI
1,77 с, backup 1,04 с и pre-upgrade 0,99 с. В `--durations=30`
доминируют call: heartbeat 15,02 с, live storage lock 2,07 с, backup CLI
1,76 с, automatic backup 1,61 с. Отдельные setup и teardown отсутствуют
в этом топе. Распределение длительностей по файлам можно повторить, сложив
`time` по `classname` в backend JUnit.

Process-level, storage, миграционные, lifecycle и конкурентные случаи
сохранены в полных наборах. Каждый worker импортирует conftest и получает
собственную временную SQLite со своим WAL, uploads, ключом и переменными
окружения. Process-level fixtures используют отдельные временные пути и
свободные порты. `loadfile` сохраняет совместное выполнение случаев каждого
файла внутри одного worker. Долгое обязательное ожидание heartbeat
перекрывается работой других файлов. Явные shards из нескольких jobs
могли бы распределить нагрузку между машинами, но повторили бы checkout,
pip и runner allocation и потребовали отдельной сборки inventory.
Выбраны четыре процесса в том же backend job. Зависимости закреплены
отдельно от runtime. Запуски служебных unittest сохранены.

В Fast CI и Full CI убран только второй запуск одинакового typecheck:
`npm run build` запускает тот же `tsc --noEmit` до Vite. Frontend unit
сохранены. Push HEAD и PR test merge сохранены как разные точки проверки.

## Проверка инвентаря и гарантий

- Node JUnit и [проверяемый инвентарь](../web/tests/browser/inventory.json)
  сопоставляются по паре «файл, имя testcase». Gate проверяет пары при
  создании отчёта и повторяет сверку для скачанного evidence. HTTP использует
  прежние импорты Catalog и Tokens на LAN, с отдельным evidence.
- Phase 1 → Phase 2: 38 обычных + 8 HTTP. Сравнение полных JUnit совпало
  после сопоставления трёх перенесённых имён Sheets с исходным файлом.
  Тела перенесённых и оставшихся случаев сверены побайтно.
- Тест с подстановкой других уникальных случаев при правильном количестве
  упал на RED. После реализации прошли 49 служебных unittest. Покрыты
  missing/failed/cancelled/skipped job, missing/duplicate/unknown evidence,
  missing/duplicate/wrong testcase, подстановка в artifact, неправильные
  SHA/run/attempt/candidate, Draft, stale head/base/test merge и ошибка API.
  Manifest выявляет структурное нарушение покрытия в доверенном workflow.
- Локально прошли actionlint 1.7.12, frontend typecheck, 25 frontend unit,
  production build, все 46 браузерных случаев и проверка Markdown. В первом
  запуске Scenes был timeout desktop Alt ping в неизменённом UI testcase.
  Контроль UI на baseline и один диагностический прогон всей Scenes прошли.
  Причина не изолирована. Тест, ожидание и timeout сохранены, автоматических
  retries нет.
- Ruleset, `CI required`, exact SHA, run ID, attempt, проверки текущего
  PR и ветки, concurrency keys и Windows release workflow сохранены.
  Два новых browser jobs входят в обязательную матрицу и reusable Full CI.

## Измерения GitHub Actions

SHA реализации — `b3515acf7b01ddff92d67f5024d6ddd5917baea7`.
[Ручной Full CI](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45572886708),
[Fast CI по push](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45572872791)
и [Windows candidate](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45572903920)
на этом SHA использовали attempt 1. Windows-колонка ниже охватывает
Linux jobs от начала reusable resolve до конца gate, без упаковки.

| Метрика | Phase 2 Full CI, dispatch | Phase 2 Full CI, reusable Windows |
| --- | ---: | ---: |
| Длительность, с | 226 | 202 |
| Runner-минуты | 21,52 | 18,55 |
| resolve, с | 5 | 6 |
| backend, с | 61 | 49 |
| frontend, с | 26 | 25 |
| browser (sheets), с | 173 | 89 |
| browser (sheet-layout), с | 174 | 187 |
| browser (tokens), с | 135 | 174 |
| browser (scenes), с | 202 | 173 |
| browser (interaction), с | 149 | 128 |
| browser (auth), с | 151 | 127 |
| browser (http-uuid), с | 210 | 150 |
| CI required, с | 5 | 5 |

В самостоятельном запуске resolve стартовал через 3 с, остальные jobs через
1–2 с после него. Параллельные jobs обоих workflow не отменили друг друга.
В dispatch все 11 jobs и все семь evidence относятся к одной попытке и
точному SHA. Мультимножество JUnit совпало с master Phase 1 для 38 обычных
и восьми HTTP случаев с учётом трёх перемещений файлов. Backend на GitHub
показал 762 passed и 1 skipped. Fast CI реализации завершился за 68 с
(back/front 65/26 с, runner time 91 с), на 30,6% быстрее исходных 98 с.

Dispatch дал 1,72× относительно 388 с и сократил время Phase 1 dispatch
на 31 с. Reusable срез дал 1,92×, с другим событием и runner. Перекрытие
запусков и разные runner делают сравнение наблюдательным. Цель 194 с не
подтверждена. Оба результата уступают ей на 32 и 8 с. Максимальный browser
job 210/187 с превышает цель 175 с на 35/12 с. Backend 61/49 с в Full CI
и 65 с в Fast CI показывает непостоянное достижение цели 60 с. Оба Full CI
укладываются в 22 runner-минуты. Ни один не достиг stretch в 18 минут.
Результаты dispatch и reusable относятся к точному SHA кандидата.
Разрешающим сигналом для merge остаётся Full CI актуального test merge.

Самый длинный browser job в dispatch — HTTP UUID. Тесты и evidence занимали
168 из 210 с. В Scenes — 162 из 202 с. На reusable критическим стал
Sheet Layout, а HTTP занял 150 с. Ещё один обычный runner оставил бы HTTP
на критическом пути части прогонов. Раздельный HTTP harness добавил бы
runner и новый путь изоляции и мог бы выйти за 22 минуты при текущих
накладных расходах. Сохранена конфигурация из семи групп для review.

### Кэши

В HTTP job dispatch первичные pip и npm ключи дали hit (32 и 53 МБ).
Интервал от сообщения hit до restore составил 0,48 и 0,99 с.
На первичных ключах save пропущен. Backend увидел miss нового точного
ключа с requirements-ci и восстановил fallback pip за 0,69 с от сообщения
hit. Установка backend заняла 8 с. Замера установки без кэша нет.
Новый pip key учитывает оба manifest и Python/платформу. npm cache хранит
пакеты по lockfile и платформе. Обе среды повторяют установку из manifest.

Медиана шага установки Chromium в dispatch Phase 2 — 14 с (13–29 с),
в Phase 1 dispatch — 18 с (17–32 с). Системные зависимости остаются частью
этого шага. Замера cache hit для отдельного кэша Playwright нет.
Headless-only исключает загрузку большого неиспользуемого браузера без
добавления нового кэша. Повторное использование production build не
измерялось, потому что suites проверяют dev Vite. Кэши venv/node_modules,
общие test evidence и повторное использование SQLite не внедрены.

### Модель параллельных PR

Репозиторий публичный, тариф владельца через API не подтверждён.
Сценарии 20 и 40 свободных стандартных слотов соответствуют публичным
лимитам Free и Pro при отсутствии других задач. [Лимиты GitHub Actions](https://docs.github.com/en/actions/reference/limits)

Модель одновременно освобождает jobs после resolve. Каждый PR выставляет
свои jobs в FIFO, начиная с самых длинных по измеренному времени.
Gate становится готов после завершения всех jobs его PR. Модель использует
реальные durations Phase 1 master и Phase 2 dispatch, исключает
диспетчеризацию, фоновые workflows, merge/rebase и изменение производительности
runner. Значения «makespan / макс. очередь» в секундах обозначают время до
завершения последнего PR и максимальное ожидание готового job.

| PR | Browser / backend / peak jobs Phase 2 | Runner-мин Phase 2 | 20 слотов Phase 1 | 20 слотов Phase 2 | 40 слотов Phase 1 | 40 слотов Phase 2 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 7 / 1 / 9 | 21,52 | 238 / 0 | 220 / 0 | 238 / 0 | 220 / 0 |
| 2 | 14 / 2 / 18 | 43,03 | 238 / 0 | 220 / 0 | 238 / 0 | 220 / 0 |
| 3 | 21 / 3 / 27 | 64,55 | 238 / 29 | 280 / 149 | 238 / 0 | 220 / 0 |
| 4 | 28 / 4 / 36 | 86,07 | 297 / 125 | 369 / 196 | 238 / 0 | 220 / 0 |

При 20 свободных слотах пиковый спрос превышает лимит с трёх Phase 2 PR.
Модель показывает возможное ухудшение общего времени при трёх-четырёх
PR. При 40 слотах оно не наблюдается. Push Fast CI добавляет до двух
одновременных jobs на ветку, а Draft может запустить отдельную проверку
test merge. Это дополнительный источник насыщения, не включённый в таблицу.
Ожидаемая ускоренная обратная связь подтверждена для одиночного Fast CI.
Пропускная способность при 3–4 реальных PR остаётся непроверенной.
На 20 слотах имеет смысл разводить момент Ready для тяжёлых PR и измерять
очередь, прежде чем расширять browser matrix.

Ключи concurrency продолжают отменять старые запуски одного PR без отмены
соседних номеров. Артефакты разделены по workflow run, attempt и группе.
После продвижения master требуется новый test merge с успешным gate.

### Windows

Candidate, все 11 jobs reusable Full CI и Windows packaging/smoke прошли
с первой попытки. GitHub проверил candidate/tested/checkout SHA, а скачанный
ZIP подтвердил тот же `SOURCE_COMMIT.txt` и совпадение SHA-256 с контрольной
суммой. Запуск использовал `publish=false` и пустой тег. Job `publish`
пропущен. [Windows candidate smoke](https://github.com/LunierVeil/Laterna-VTT/actions/runs/45572903920)
