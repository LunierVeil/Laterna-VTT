# PB-08A · SQLite catalog и основа Alembic

Base `04e0780f7c473b213b98dc6506e4c4236421e63b`. [Issue PB-08](https://github.com/LunierVeil/Laterna-VTT/issues/49) открыт.
Срез A вводит классификацию и начальную ревизию для пустого файла. FastAPI,
CLI backup/restore и launcher сохраняют текущие точки входа. Код среза A
вызывается профильными тестами. Подключение к lifecycle и любой перенос
живой Alpha относятся к следующему срезу.

## Готовность PB-07

Критерии [Issue #48](https://github.com/LunierVeil/Laterna-VTT/issues/48)
сопоставлены с принятыми [PR #82](https://github.com/LunierVeil/Laterna-VTT/pull/82)
и [PR #83](https://github.com/LunierVeil/Laterna-VTT/pull/83). Оба входят
в base. Issue открыт для независимой приёмки.

| Критерий | Реализация | Проверки |
| --- | --- | --- |
| Периодические верифицированные копии | Lifespan запускает worker. Планировщик восстанавливает расписание, ограничивает повторы и дожидается остановки. Копия проходит проверку перед публикацией. | `test_policy_and_virtual_clock`, `test_scheduler_virtual_wait_one_run_per_wake_and_backoff`, `test_real_lifespan_automatic_backup_shares_manual_slot_and_allows_http_ws`, `test_shutdown_waits_for_inflight_worker` |
| Retention и последняя пригодная копия | Серию ограничивают возраст, число и объём. Сохранённая пригодная копия заново проверяется перед удалением кандидата. Неопознанный каталог сохраняется. | `test_prunes_only_registered_copies_and_restores_survivor`, `test_unusable_new_copy_cannot_displace_working_copy`, `test_retention_write_failure_keeps_survivor_and_halts` |
| Свободное место и disk full | Резерв проверяется при допуске и перед публикацией. ENOSPC оставляет последнюю пригодную копию. Штатный retention может удалить просроченное до отказа новой попытки. | `test_disk_reserve_and_logical_budget_block_writes`, `test_write_failures_preserve_last_verified_backup` |
| Обязательный snapshot, receipt, marker | Gate под storage locks проверяет catalog, место, журналы, mount и ключ. Свежий snapshot верифицируется отдельно. Записанные receipt и fence синхронизируются и проверяются перед выдачей допуска. | `test_verified_snapshot_precedes_writer_and_can_restore`, `test_tampering_blocks_writer`, `test_replaced_receipt_with_same_contents_does_not_authorize` |
| Блокировки и долговечность | Обычный startup и вторая попытка блокируются при fence. Linux проверяет mount и fsync файлов и каталогов. Linux crash/fault тесты проверяют порядок операций. Windows smoke проверяет отказ записи. | `test_real_process_crash_requires_safe_retry`, `test_fence_fsync_failure_preserves_source_and_defers_retry`, `test_real_linux_mount_and_durability`, [Windows smoke](../scripts/windows-datahome-smoke.py) |

Блокирующих дефектов в принятом scope PB-07 B/C не обнаружено. Сохраняемая
гарантия относится к последней проверенной пригодной копии, даже если
штатный retention успел удалить просроченную. Реальное отключение питания
в Linux этим покрытием не доказано. [Автоматические копии и gate](PB07_AUTOMATIC_BACKUP.md)
· [Тесты PB-07 B](../server/tests/test_automatic_backup.py)
· [Тесты PB-07 C](../server/tests/test_pre_upgrade.py)
· [Проверяемый restore](PB06_BACKUP.md)

PB-07 передаёт доверенному writer проверенный снимок и удерживает блокировки.
Он не реализует преобразование, cutover, снятие маркера и восстановление
операции PB-08. Windows pre-upgrade writer остаётся заблокирован.

## Подтверждённые Alpha-каталоги

Подтверждён один вариант, SQLite из исходного Alpha
[`4d2797d4589d42c11ac7e6fb6b13d338d011190f`](https://github.com/LunierVeil/Laterna-VTT/commit/4d2797d4589d42c11ac7e6fb6b13d338d011190f)
со штатными DDL, `user_version=0`, `application_id=0` и без Alembic.
Изменение `models.py` в `ea4a245` меняло описание Wall. Сравнение файла
от первого коммита до base не выявило изменения DDL. Исторический
`create_all` запущен из Git-архива на SQLite в памяти. Его 18 объектов воспроизводят SHA-256 из контракта PB-07 C
`9ad6459f345338d3cb76f5720090000b2f56bf2d1f439cfb53513d5979700c4b`.
Каталог охватывает таблицы, индексы и определения объектов. Это доказательство
структуры из Git, без использования живой БД. В Git нет тегов и список
GitHub Releases пуст. Более старые или изменённые схемы, включая варианты со
столбцами, добавленными вручную или историческим `_check_columns`, требуют
отдельного воспроизводимого fixture и контракта. Совпадения имён таблиц и
столбцов недостаточно.

## State machine и границы записи

В A `inspect_schema` читает `main` переданного SQLite-соединения. Политика
открытия файла, sidecars и блокировок остаётся у будущего storage caller.
Классификатор не доказывает готовность DataHome или наличие активной сцены.
Проверка файлов DataHome, владельца, ключа и активной сцены остаётся в PB-05.

| Состояние | Критерий | Разрешённый переход |
| --- | --- | --- |
| Новый, пустой | Нет объектов SQLite, обе PRAGMA нулевые, integrity check пройден | A создаёт baseline только в отдельно подготовленном пустом файле. Публикация нового DataHome и seed относятся к B. |
| Подтверждённая Alpha | Точное совпадение исходного каталога, отсутствие версии, проверены integrity и FK | A распознаёт. B предложит офлайн-перенос через свежий снимок на отдельную копию. |
| Текущая Alembic | Единственная `0001_alpha_baseline`, ожидаемый catalog и version table, integrity и FK | A распознаёт. Обычный startup с version preflight подключается в B. |
| Старая известная Alembic | Тогда существует разрешённый путь от прежнего подписанного каталога | В A нет прежних ревизий. В дальнейшем переход только через offline gate. |
| Неизвестная, неподдерживаемая или более новая | Версия отсутствует в графе, метаданные чужие или Alpha-каталог отличается | Отказ без stamp и ALTER. Неизвестную строку revision нельзя надёжно датировать. |
| Drift | Известная версия с другим catalog или несовместимая version table | Отказ без правок. Нужен отдельный анализ. |
| Повреждение или нарушение FK | Ошибка SQLite, integrity check или foreign_key_check | Отказ. Проверяемое восстановление в отдельный DataHome. |
| Прерванный upgrade | Маркер на исходном DataHome или неполная целевая публикация | Маркер блокирует старт. Ни автоматического снятия, ни новой попытки на старом receipt. |
| Несовместимый режим | Sidecars на источнике, per-file overrides, неподдерживаемый FS или внешний ключ без договора хранения | PB-07 gate закрыт. В A инициализация требует нового файлового `main`, DELETE journal, synchronous FULL/EXTRA и transaction mode sqlite3 legacy. TEMP, ATTACH, autocommit и in-memory путь отклоняются. |

В A используется одна immutable-ревизия с буквальным DDL и независимой
проверкой каталога. Alembic получает переданное SQLAlchemy-соединение и
явный `BEGIN IMMEDIATE` для транзакционного DDL. Повторная проверка пустоты
идёт после получения транзакции записи. До commit проверяются целевая ревизия,
integrity, FK и каталог. Тесты прерывают процесс после первых DDL и
проверяют rollback на синтетической SQLite. Это тест аварии процесса.
Долговечность всего DataHome при отключении питания требует отдельного
доказательства. [Alembic: переданное соединение](https://alembic.sqlalchemy.org/en/latest/cookbook.html#sharing-a-connection-across-one-or-more-programmatic-migration-commands)
· [SQLite: rollback journal и synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)

Standalone Alembic CLI для
пользовательского DataHome не настроен, destructive downgrade отсутствует.

Для будущих ревизий меняются граф, классификатор и fixtures вместе. Новая
ревизия должна иметь одного родителя, ожидаемый исходный и конечный каталог
и тест перехода. Autogenerate помогает подготовить черновик, а доказательства
дают проверки структуры и данных. Подключение к асинхронному startup и политика PostgreSQL в этом этапе
остаются прежними. Действующий `create_all` и
`_check_columns` остаются вне новых путей. SQLite startup уже не вызывает
`_check_columns`; legacy helper для другого backend в A не трогаем.

## Срезы B/C и recovery

1. **B · Linux migration.** Подключить Alembic к созданию нового экземпляра
   и отдельному offline entry point. Под locks провести PB-07 gate и получить
   свежий снимок. Целевой DataHome формировать копированием из снимка,
   с подчинённой политикой блокировок. Stamp в этом пути допустим только
   для точно подтверждённой Alpha-копии после повторной проверки.
   Зарегистрировать migration route отдельно от чистого init.
2. **B · Верификация.** Под теми же locks подтвердить точную revision,
   integrity, FK, структуру и семантическую эквивалентность fixtures до
   разрешения cutover. Синтетические данные должны покрыть UUID, пользователей,
   сессии, кампании, сцены/папки, токены, персонажей dnd5e/mob, листы, ресурсы,
   инициативу, сообщения, media и ссылки, GM key, ownership, ACL и связи.
   Проверять значения, отношения и байты ссылочных ресурсов. Договор требует
   сохранить исходную Alpha. [Beta decisions](BETA_DECISIONS.md#архитектурные-инварианты-и-порядок)
3. **C · Recovery и launcher.** Согласовать долговечный момент cutover,
   принадлежность marker обеим сторонам и явный выбор DataHome. Удерживать
   блокировки от допуска через запись и независимую проверку до фиксации
   результата. До маркера допустима новая попытка с новой копией. После
   маркера startup и повторная попытка закрыты. Оператор восстанавливает
   в новый DataHome штатным PB-06 restore. Снять маркер можно только после
   подтверждённого cutover или отдельного подтверждённого recovery. Нужны
   fault/crash точки до snapshot, на backup/verify/ENOSPC/receipt/fence,
   при частичной записи, после commit и до финализации. Снимать marker по
   одному успешному возврату Alembic нельзя. Исходник и неясные результаты
   попытки сохраняются.

Техника переключения между каталогами, восстановление после сбоя cutover
и взаимодействие со старым launcher требуют отдельной спецификации.
Между исходником и копией может быть разный mount, поэтому запас места
для копии и записи проверяется отдельно от допуска PB-07.

## Linux и Windows

| Среда | PB-07 | PB-08A | Alpha upgrade |
| --- | --- | --- | --- |
| Linux, локальный ext4/XFS/Btrfs с допустимыми mount options | Backup/restore, автоматические копии и gate | Классификация каталога, foundation нового файла | Срезы B/C после review |
| Linux, прочие mount и несовместимые storage modes | Gate fail-closed, PB-06 действует по своим условиям | Классификация SQLite отделена от допуска | Закрыт |
| Windows Profile, локальный каталог | Backup/restore. Gate writer запрещён | Foundation без подключения к launcher | Закрыт |
| Windows Portable, каталог рядом с приложением | Backup/restore. Gate writer запрещён | Foundation без подключения к launcher | Закрыт |

**Windows design gate.** Flush файла не доказывает долговечность всей
иерархии после rename. Flush тома требует административных прав, а
Portable может находиться на другом типе FS или съёмном носителе.
Официальные описания не дают достаточного основания для эквивалента
существующего Linux gate. [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)
· [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)

Кандидат на обсуждение — новый приватный DataHome на явно поддержанном
локальном Windows FS и durable журнал решения, из которого launcher
проверяет целевую публикацию при возобновлении. Выбор формата журнала,
согласованность журнала и каталога, ограничение Portable и правила
fallback требуют утверждения. На изолированных Profile/Portable нужны
process kill на каждом переходе и аварийный перезапуск Windows VM между
записью, публикацией и cutover. Критерии — неизменный исходник с ключом и
медиа, неполная публикация не запускается, recovery воспроизводим.
Действующий smoke подтверждает только отказ Windows gate, тестов
долговечности этой кандидатной схемы ещё нет. Владелец выбрал Linux-first и отдельный design gate для Windows. Это
определяет порядок дальнейшей работы. Блокировка Windows сохраняется,
а весь PB-08 остаётся незавершённым.

## Владение файлами

PB-08 владеет `db.py`, `models.py` при смене схемы, `schema_catalog.py`,
`schema_migrations.py`, migration tree, `pre_upgrade.py`,
`storage_preflight.py`, storage lifecycle, lifespan в `main.py`,
профильными storage/migration tests и документацией. A меняет только
каталог и migration foundation, переиспользование хеша PB-07,
backend dependency и соответствующие тесты. PB-09A может работать с
data-neutral модулями. Точки пересечения для согласования — imports и
lifespan `main.py`, общие backend зависимости и тестовые helpers.

## Доказательства PB-08A

Поведенческий RED подтвердил, что `create_all` не создаёт запись Alembic.
После реализации и исправлений внутреннего review прошли 24 теста foundation:
граф, точный Alpha, version/drift/повреждение/FK, побайтовая неизменность
отказов, TEMP shadow, неподдерживаемые режимы, fault и process crash после
начала DDL, повторная инициализация пустого файла после rollback.

Полный backend pytest на Linux/Btrfs дал 787 passed без skip. В него входит
реальная проверка mount и fsync PB-07. Прошли 49 служебных unittest и
Chromium suites `smoke` и `auth`. Windows wheels для CPython 3.12 разрешаются
для новой зависимости. Это проверка упаковочных предпосылок, без запуска
Windows VM или Windows upgrade. Проверки семантики Alpha → Beta → restore
для полного набора игровых данных принадлежат будущему offline-пути B/C.
