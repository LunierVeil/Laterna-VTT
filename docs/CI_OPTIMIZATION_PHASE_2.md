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
