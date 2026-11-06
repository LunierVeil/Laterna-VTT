# PB-01d-3 — проверяемый прототип контекста вычисления

**Изолированный экспериментальный этап завершён: PR #37, review PASS WITH RISKS.**
Одобрен HEAD `0b5ee4f3f763d593100a8698a565fa38884dd8b6`; merge-коммит master
`baa7695ff4654c3317cd5143b05fd7bf8cba83d0`,
[Full CI master](https://github.com/LunierVeil/Laterna-VTT/actions/runs/42112696994) успешен.
**D10/D11 остаются OPEN для runtime**, гарантии/ограничения ниже сохранены.
Актуальный [план интеграции](PB01D_INTEGRATION_PLAN.md) учитывает Owner Decision:
Linux-first, функциональный PB-02 без обязательных I-01a/I-01b и Windows benchmark.
Это не утверждение всех runtime gates и не разрешение нового scope этим документом.
Исходная база реализации: `c48f0ccd7cc24d529b2d1a70bf25ac5ebe59068e` после обычного
[merge PR #36](https://github.com/LunierVeil/Laterna-VTT/pull/36).
[Full CI master](https://github.com/LunierVeil/Laterna-VTT/actions/runs/42102118552)
успешен: backend/frontend, все 38 Chromium tests и CI required.

Нет подключения к REST/WS, игровому циклу, frontend, AccessPolicy или FoW. Нет DB
adapter реальных источников, mapping emits_light/vision_range, миграции, изменения
схемы/persisted JSON. W3 и правила зрения остаются OPEN. Прототип использует
точные [LOS](../server/app/line_of_sight.py) и [Basic Lighting](PB01D_BASIC_LIGHTING.md),
никогда approximate polygon. Это не permission/authorization API.

## Состав решения

- [computation_context.py](../server/app/computation_context.py): immutable
  ContextInput/SourceInput, build_context, ComputationContext и ContextVersion.
- [computation_runner.py](../server/app/computation_runner.py): явные RequestBudget,
  отдельный ограниченный ThreadPoolExecutor, поколения запросов, отмена и локальный
  слот принятого результата. Это конкретный runner этого ядра, не job broker.
- [context tests](../server/tests/test_computation_context.py),
  [worker tests](../server/tests/test_computation_runner.py),
  [SQLite probe](../server/tests/test_sqlite_snapshot_isolation.py).

### Контекст и версия

Вход — глубоко неизменяемые tuple captures с native int/float и frozen SourceInput.
Mutable списки, неправильные позиции/радиусы/ambient или источник на препятствии
отвергаются; неисправная лампа не пропускается. ContextInput задаёт scope_key,
явную producer-owned state_revision, размеры/epsilon, opaque segments, источники
и ambient. Не выбирается новый mapping стен/дверей/окон: caller передаёт opaque
геометрию по действующим правилам PB-01c, источник задаётся явно.

Builder создаёт одну immutable PreparedGeometry и привязывает к ней все источники.
ContextVersion — **значение**, содержащее scope_key, state_revision и SHA-256
нормализованного содержимого: размеры, epsilon, ambient, каждый raw segment
(включая нулевые/порядок), позиции и радиусы источников. Float кодируется через
hex; нет зависимости от id(object), hash randomization, неявной JSON-миграции
или предположения, что Scene.seq отражает все изменения. Равные независимые
captures дают равные версии, другой источник/стена при том же revision меняет digest.
Это консервативное versioning, не доказательство равенства геометрических областей.

**Hash описывает переданный набор, а не доказывает, что он был согласованно прочитан
из БД.** Захват согласованного состояния — обязанность будущего доверенного producer.
У контекста нет глобального кеша, IO или автоматической свежести.

### Поколения и локальная публикация

У каждого runner собственный scope nonce и монотонное поколение запроса. Каждый
run (даже с тем же revision/данными) и invalidate/close отменяет старую работу и
очищает latest. Поэтому A→B→A не позволяет первому A перезаписать новое состояние.
Поколение покрывает также изменение запроса/наблюдателя при прежнем мире.

Worker возвращает только immutable данные. Приём COMPLETE в **локальный** latest
выполняется под тем же lock, что run/invalidate/close: проверка текущего поколения,
срока выполнения и запись без await/внешнего callback между ними. Поздняя работа,
отмена старого awaiter или её callback не могут перезаписать/очистить новый результат.
INCOMPLETE/UNAVAILABLE не содержат ни одного частичного ответа и не попадают в latest.

COMPLETE означает «расчёт этого набора завершён», не Visible, право публикации или
вечную актуальность. PointAnswer возвращает SightResult и LightResult **раздельно**.
OBSERVER_ON_OBSTACLE может быть диагностическим G рядом с LIT; это не разрешение видеть.

**Граница гарантии:** latest — внутренний слот, не отправка в сеть. invalidate
требует явного уведомления producer при изменении состояния. Неизвестную запись
другого процесса/прямой SQL runner не обнаруживает. Уже возвращённое immutable
значение нельзя автоматически отозвать. Будущему реальному publisher нужен atomic
revalidation/commit в его доверенном coordinator; check-then-await-then-send не безопасен.

## D10: бюджеты, выполнение и отмена

Все значения задаёт caller, **production defaults/SLA не введены**:

- max_segments, max_sources, max_queries — неотрицательные целые, bool запрещён.
- preparation_seconds и query_seconds — положительные конечные секунды.
- workers — явно заданная ёмкость конкретного runner, не глобальный лимит сервера.

Размеры immutable tuples проверяются до подготовки. Верхняя граница вызовов
основных point-предикатов при Q запросах/S лампах — Q геометрических проверок и
до Q×S световых LOS (часть отсекается радиусом/первым LIT); source-подготовка
также проверяет S позиций. Это не бюджет одной операции Fraction или byte-size.

Всё тяжёлое — в worker: валидация/PreparedGeometry, привязки, digest и point calls.
Прямой build_context из asyncio event loop запрещён до начала подготовки. Async
run не копирует/обходит большой capture синхронно: получает immutable вход и
передаёт его worker. Стоимость создания capture/SQL-чтения сюда не входит.

Отмена **кооперативная**: checkpoints между сегментами, источниками, записями hash,
геометрическим и световым point calls; проверяются поколение, Event и phase deadline.
Подготовка и запросы имеют отдельные замеры/лимиты. Await timeout ограничен суммой
двух явных временных бюджетов от submission, включая запуск worker.

- Счётный/временной бюджет: INCOMPLETE, без частичного положительного результата.
- Ошибочные входы, stale, busy или closed: UNAVAILABLE; неисправность ядра не
  превращается в CLEAR/LIT — неожиданная ошибка поднимается вызывающему коду.
- Отмена asyncio task ставит флаг/инвалидирует только её поколение и пробрасывает
  CancelledError. Отмена старого awaiter не очищает новый latest.
- Не более workers фактически незавершённых concurrent Futures, без тихой очереди.
  Новый run при занятости инвалидирует старый, но возвращает busy; retry — решение
  caller. Timeout ожидания **не освобождает** ёмкость ещё работающего CPU job.
- close инвалидирует работу без синхронного ожидания в event loop; aclose отдельно
  асинхронно дожидается фактического выхода workers, освобождая executor.

**Это не жёсткое прерывание потока/CPU/memory и не wall-clock SLA.** Одна уже
начавшаяся атомарная операция старого ядра может продолжаться после timeout до
следующего checkpoint. GIL/нагрузка event loop могут задержать обработку таймера.
После истечения бюджета положительный ответ не принимается, но CPU не гарантированно
остановлен в эту наносекунду. Тесты специально удерживают атомарную операцию после
timeout и проверяют отсутствие очереди/поздней публикации. Нет глобального admission
для произвольного числа runner instances; размеры metadata/чисел и hard memory cap
также не объявляются ограниченными этими счётчиками. Перед недоверенным runtime
нужны отдельные лимиты capture/bytes, scheduler и решение об изоляции CPU.

## D11: фактический SQLite эксперимент

Только временные БД pytest, две синтетические revision-таблицы; нет чтения моделей
Token/Light, изменения app.db или source DB adapter. Несколько SELECT, **без JOIN
walls×sources**. Writer атомарно меняет обе revision, пока reader между чтениями.

Локально: Python 3.12.14, SQLite 3.53.1, SQLAlchemy 2.1.6, aiosqlite 0.22.1;
используется тот же default create_async_engine/AsyncSession стиль, что в app.db.

| Режим теста | Session.in_transaction | Физическая transaction после SELECT | Прочитанная пара | После writer commit |
| --- | --- | --- | --- | --- |
| Python legacy/default aiosqlite | true | false | geometry=1, sources=2 | смешанный capture возможен |
| Явный BEGIN, WAL | true | true | geometry=1, sources=1 | новое чтение после окончания reader видит 2/2 |
| Явный BEGIN, writer rollback | true | true | 1/1 | свежая пара тоже 1/1; uncommitted не раскрыта |

Это доказательство поведения **проверенных режимов/версий**, не универсальная
гарантия всех драйверов/изоляций. SQLAlchemy logical begin сам по себе в legacy
mode не заставляет SQLite начать read transaction. Временный WAL позволяет writer
commit при удерживаемом старом reader snapshot. Явный BEGIN даёт согласованную
**старую** версию, не freshness или authorization lease. Production connection
настройки/PRAGMA/transaction hooks не изменялись.

Предлагаемый будущий producer: одна проверенная read transaction, отдельные SELECT
геометрии/согласованных источников в том же соединении, immutable capture и revision
полного набора. Но физический source schema/mapping D05/D06 и механизм окончательного
revalidation должны быть отдельно согласованы. Нельзя просто перенести эти две
тестовые таблицы в приложение или использовать один Scene.seq как сертификат.

## Benchmark и тестовый профиль

```bash
server/.venv/bin/python scripts/benchmark_computation_context.py --samples 3
```

[Скрипт](../scripts/benchmark_computation_context.py) использует PB-00 complex:
30 synthetic token positions, 200 стен, 15 **явно заданных** источников с radius=700 px.
Старые поля света токенов не читаются. Два распределения: исходные точки PB-00
(они выше массива стен, оптимистичный случай) и cross-wall с перемещёнными test
позициями через стены. По 30 запросов от первого observer и по 900 всем парам.
Это тестовые сценарии, не игровые правила shared vision и не SLA.

Для измерения указаны workers=1, max_segments=200/max_sources=15/max_queries=Q,
phase budgets по 60 s. **Это только широкие ceilings эксперимента**, не утверждённая
policy. Каждый run строит новый request-scoped контекст. Fixture creation и прямой
exact-kernel oracle исключены из timings. Worker ответы сверяются с прямым ядром.

Раздельно измеряются worker preparation (валидация/геометрия/свет/digest), point
queries и полное async-время (submission/scheduling/acceptance). Три повтора, p95 —
nearest-rank (максимум из трёх); один warmup на случай, GC collect вне таймера.
Memory — отдельный tracemalloc request, включая async/worker allocations, не RSS
и не отсутствие утечек. Готовые fixture input и oracle созданы до замера памяти.

Локально: Python 3.12.14, Linux x86_64, AMD EPYC 9V74, 5 доступных CPU, один worker.
Время, ms median/p95 (p95 = максимум из трёх), полный новый контекст на каждый run:

| Распределение | Q | Worker preparation | Point queries G/L | Полный async run | Request peak, KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| pb00-original | 30 | 2.633 / 2.724 | 3.113 / 3.941 | 6.956 / 7.085 | 175.599 |
| pb00-original | 900 | 2.655 / 2.824 | 95.616 / 105.577 | 98.783 / 109.004 | 318.138 |
| cross-wall | 30 | 2.516 / 2.592 | 9.180 / 9.416 | 11.999 / 12.290 | 175.892 |
| cross-wall | 900 | 2.501 / 2.524 | 272.912 / 274.481 | 275.945 / 277.802 | 318.263 |

Исходный PB-00 даёт 30/30 и 900/900 геометрических CLEAR: токены расположены выше
стен. Cross-wall даёт соответственно 17 CLEAR/13 BLOCKED и 290 CLEAR/610 BLOCKED;
LIT/UNLIT — 19/11 и 570/330. Поэтому число токенов/стен/ламп без распределения лучей
не определяет стоимость. Проверенные 30/200/15 — **не автоматически утверждённый SLA**.
Memory peak включает новые worker/loop/results allocations; это не весь heap.

## Проверки и оставшиеся gates

Профильные tests покрывают immutable capture/version, один bound snapshot, изменённые
входы при прежнем revision, SQL legacy/BEGIN/rollback, count/phase deadlines,
cooperative cancel, timeout с ещё работающим worker, busy без накопления очереди,
ABA, отмену старого awaiter после нового результата, late invalid query, ошибки
ядра и восстановление capacity. Синхронизация race tests — Events, без sleep;
watchdog ожидания только предотвращает зависание самого test harness.

Реальные гарантии **этого прототипа**:

1. Глубоко immutable вход и один математический snapshot для G/L.
2. Версия содержимого не зависит от Python identity и не полагается на полноту seq.
3. Уведомлённое старое поколение не принимается в локальный latest, включая ABA.
4. Нет частичного положительного ответа после ошибки/бюджета/отмены.
5. CPU math работает в executor; ожидание/принятие результата — в asyncio.
6. Реальная незавершённая работа удерживает admission capacity после timeout.
7. На тестовой SQLite явный BEGIN обеспечивает coherent read, legacy SELECT — нет.

**Не гарантируется:** авторитетность входного capture, обнаружение неуведомлённой
SQL-записи, межпроцессная актуальность, атомарность будущего DB→network publication,
жёсткий CPU/memory stop, глобальное ограничение всех runner instances, отсутствие
GIL scheduling delays, готовность игрового FPS или совместимость любого драйвера.
Уже возвращённый COMPLETE не является lease и не должен использоваться для отправки
секретных объектов. ContextVersion не является криптографическим разрешением доступа.

Для полного runtime остаются решения по фактическому scope:

- D10: N/S/Q/bytes/CPU/memory budgets и admission всей системы; основная платформа
  владельца — CachyOS/Arch Linux. Для ограниченного PB-02 разрешены временные
  fail-closed лимиты, не production SLA. Отдельный global scheduler, hard isolation
  и Windows benchmark не prerequisite; Windows acceptance остаётся релизным gate.
- D11: trusted read transaction/version полного набора и revalidation до выдачи,
  rollback, scene/identity lifecycle — минимально внутри функциональных PR.
  Защита произвольных внешних writers не доказана и не объявляется готовой.
- D05/D06: реальный source schema/mapping, позиция/радиус/состояние и сохранения,
  при необходимости migration gate. В этой работе DB adapter не создан.
- W3, правила зрения и личного/общего обзора; FoW и PB-02 AccessPolicy/projection
  требуют самостоятельного scope. Старые поля света не переинтерпретировать.

Модули не вызываются из приложения. Старые math, DB, REST/WS и game code
не изменены. Review и Full CI test merge/master PR #37 завершены; это не разрешает
runtime-интеграцию. План следующего шага отдельный, релиз не запускался.

## Фактическая валидация перед публикацией

- Полный backend pytest: **523 passed**, один прежний Starlette/httpx warning.
- Все профильные geometry/broadphase/prepared/visibility/lighting/context/worker/SQLite:
  **304 passed**; context/worker/SQLite/lighting subset — 138 passed.
- Frontend unit: **118 passed**, failed/skipped/cancelled 0; TypeScript/build PASS.
  Прежнее предупреждение Vite о большом chunk осталось, frontend не менялся.
- Structure tests: **31/31 PASS**; локальные Markdown-ссылки/якоря: **310 PASS**
  (внешние URL checker не скачивает); `git diff --check` PASS.
- Побайтовая проверка старых db/models/main/handlers, movement, LOS, Lighting,
  Visibility Area и Scene service: изменений нет. Runtime callers новых модулей
  отсутствуют, зависимости направлены runner → context → lighting/LOS, без нового
  цикла/DB adapter. Manifest/counts/strict gate/timeouts/dependencies не менялись.

Fast CI трёх логических SHA прошёл до следующих этапов. После независимого review
успешен [Full CI test merge](https://github.com/LunierVeil/Laterna-VTT/actions/runs/42110054593),
затем Full CI master на merge-коммите выше. Завершён только изолированный scope;
подключение в игру и решения D10/D11 требуют нового согласования.
