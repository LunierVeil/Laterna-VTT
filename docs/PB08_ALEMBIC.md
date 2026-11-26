# PB-08 · Жизненный цикл SQLite и Alembic

[Issue PB-08](https://github.com/LunierVeil/Laterna-VTT/issues/49) открыт.
[PB-08A](https://github.com/LunierVeil/Laterna-VTT/pull/93) добавил каталог
и начальную ревизию. PB-08B подключает её к первому запуску Linux и
отдельной офлайн-подготовке подтверждённой Alpha. Переключение экземпляра
на подготовленный DataHome относится к PB-08C.

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

`inspect_schema` читает переданное SQLite-соединение.
Режим соединения определяет caller: открытие исходной БД в RW способно
восстановить горячий журнал уже при чтении. Startup и PB-07 gate удерживают
storage locks, проверяют обычный файл и его идентичность, отклоняют
`-journal`, `-wal` и `-shm` и открывают SQLite через `mode=ro&immutable=1`.
Для предобновительного снимка gate также читает байты 18 и 19 заголовка SQLite
под storage locks и допускает только формат rollback journal (`1/1`).
Это исключает чистую WAL-базу (`2/2`) даже после checkpoint и закрытия
всех соединений. Проверка выполняется до обращения к online snapshot API,
который для WAL поддерживает штатное резервное копирование работающего стола.
Startup дополнительно сверяет DataHome, ключ и активную сцену.
Locks исключают другие совместимые операции Laterna. На время переноса
старый сервер и сторонние SQLite-клиенты должны быть остановлены.
[Проверки DataHome](PB05_DATAHOME.md)

| Состояние | Действие |
| --- | --- |
| Новый файловый DataHome Linux | Под storage locks зарезервировать пустой файл, подготовить uploads и ключ. В одной транзакции создать baseline и начальную кампанию с активной сценой. Проверить ревизию, каталог, integrity и FK до commit. |
| Прерванная инициализация | Если файл пуст, невалиден или остались sidecars, остановить startup. Сохранить частично созданные файлы для диагностики. |
| Подтверждённая Alpha | Обычный startup допускает точный совместимый каталог с активной сценой без изменения схемы. Offline-команда может подготовить отдельную копию. |
| Текущая Alembic | Единственная `0001_alpha_baseline` и точный каталог. Обычный startup проверяет их и не запускает Alembic. |
| Старая известная Alembic | В графе пока одна ревизия. Для будущего перехода нужен утверждённый исходный каталог и offline gate. |
| Неизвестная или более новая | Отклонить каталог с неизвестной ревизией, метаданными или неподдерживаемой Alpha. По неизвестному имени ревизии нельзя определить её возраст. |
| Drift, повреждение или нарушенный FK | Отклонить startup и offline upgrade, сохранить исходник. Проверенный backup можно восстановить по PB-06 в отдельное место. |
| Начатая или подготовленная миграция | Обычный startup блокируется при source/target marker, а также внутри зарезервированного staging-каталога. Отложить дальнейшие действия до подтверждённого recovery или cutover. |
| Несовместимый режим | Gate закрыт при WAL-формате, sidecars, per-file overrides, неподдерживаемой платформе/FS или внешнем ключе. Alembic требует файловый SQLite `main`, DELETE journal, FULL/EXTRA synchronous и транзакционный режим sqlite3 legacy. |

Одна неизменяемая ревизия содержит буквальный DDL. Alembic использует
переданное SQLAlchemy-соединение и явную SQLite-транзакцию. Граф,
классификатор и fixtures будущих ревизий меняются вместе. Новая ревизия
должна иметь одного родителя, ожидаемый исходный и конечный каталог
и тест перехода. Autogenerate подходит для черновика. Совместимость
подтверждают проверки схемы и данных. Отдельный Alembic CLI для пользовательского
DataHome и destructive downgrade отсутствуют.
[Alembic: переданное соединение](https://alembic.sqlalchemy.org/en/latest/cookbook.html#sharing-a-connection-across-one-or-more-programmatic-migration-commands)
· [SQLite: rollback journal и synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)

## Подготовка копии Alpha на Linux

Явный офлайн-вход запускается из `server/` в Python-окружении Laterna.
Остановите исходный экземпляр и внешние клиенты до запуска. Пути задаются
абсолютно. Цель должна отсутствовать и лежать под существующим каноническим
каталогом, принадлежащим оператору и недоступным для записи группе и остальным.
Путь не может пересекаться с источником или проходить через symlink.

```bash
python -m app.migration_cli --source "$ALPHA_DATA_HOME" --destination "$NEW_DATA_HOME"
```

1. PB-08B захватывает storage locks назначения, повторно проверяет отсутствие
   цели и идентичность родительского каталога. Занятая блокировка отклоняет
   попытку до создания снимка и source marker. Эти блокировки удерживаются
   до завершения публикации и очистки.
2. PB-07 захватывает блокировки источника, проверяет его каталог, место и
   политику ключа, создаёт и отдельно верифицирует свежий snapshot, фиксирует
   receipt и source marker. PB-08B подтверждает manifest по хешу receipt и
   повторно проверяет mount и запас места назначения. PB-06 использует
   уже удерживаемые locks и восстанавливает файлы в приватный staging. Исходная
   SQLite, uploads и ключ сохраняются побайтово. Целевые файлы имеют
   собственные inode.
3. После проверки каталога копии блокирующий target marker записывается
   до Alembic stamp. Штамп регистрирует `0001_alpha_baseline` только в
   целевой копии. Структура прикладных таблиц Alpha уже соответствует
   этой ревизии.
4. Перед публикацией независимо сверяются revision, каталог, integrity
   и FK. Строки каждой прикладной таблицы сравниваются по первичному
   ключу, а состав и содержимое медиа и ключа сверяются с manifest.
   После синхронизации файлов и каталогов цель публикуется атомарно
   без замены существующей, затем синхронизируется её родитель.
   Mount цели может отличаться от mount источника.

После команды оба экземпляра остаются заблокированными. Marker цели
содержит идентификатор попытки, исходную и целевую ревизии и SHA-256
manifest. Сообщение об успехе означает готовность проверенной копии
к дальнейшей приёмке. Для работы со старым launcher требуется отдельная
проверка: исторический бинарник может не знать про marker.
[Offline-команда](../server/app/migration_cli.py)
· [Путь подготовки](../server/app/alpha_upgrade.py)
· [Тесты сохранности и отказов](../server/tests/test_alpha_upgrade.py)

## Recovery и граница PB-08C

Если ошибка возникла до фиксации source marker, повторная попытка
возможна только после проверки состояния и с новым snapshot. После
фиксации source marker запуск и повторная попытка блокируются. Если внешний
процесс в обход locks создаст цель после допуска, повторная проверка
или атомарная публикация без замены оставит её нетронутой. Когда source
marker уже зафиксирован, он сохраняется для подтверждённого recovery.
Авария
может оставить staging или уже опубликованную, но заблокированную цель.
Даже при ошибке fsync после публикации marker цели сохраняется. Сбой
процесса и инъекции ошибок покрыты тестами. Эффект отключения питания
на каждом поддерживаемом устройстве этими тестами не измерен.

PB-08C определит долговечный cutover, выбор DataHome в launcher,
финализацию обоих маркеров и recovery после прерванного переключения.
Подтверждённый snapshot можно восстановить штатным PB-06 в отдельный
DataHome по процедуре оператора. Успех Alembic сам по себе не разрешает
снимать marker, заменять исходник или повторно использовать receipt.
[PB-06 restore](PB06_BACKUP.md) · [PB-07 gate](PB07_AUTOMATIC_BACKUP.md)

## Linux и Windows

| Среда | Новая файловая SQLite / совместимый startup | Offline Alpha |
| --- | --- | --- |
| Linux, ext4/XFS/Btrfs с допустимыми mount options | Alembic + seed при первом запуске. Существующий Alpha и текущая revision запускаются после preflight | Подготовка проверенной, заблокированной копии |
| Linux, иные mount или несовместимый storage mode | Проверка SQLite и DataHome отделена от upgrade gate | Отказ gate |
| Windows Profile и Portable | Существующее создание схемы и seed сохраняются. Совместимый startup проверяет каталог | Отказ до записи |
| In-memory и существующий PostgreSQL path | Прежний путь инициализации | Вне scope |

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
профильными storage/migration tests и документацией. B также подключает проверенную
подготовку копии в PB-06 restore и не меняет публичную процедуру восстановления.
Модули PB-09A используются в проверке сессий и кампании. A меняет только
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
Windows VM или Windows upgrade. PB-08B проверяет Alpha → подготовленная копия. Проверка финального
переключения экземпляра остаётся для PB-08C.

## Доказательства PB-08B

Синтетическая Alpha проверяет идентичность UUID, ролей, сессий и
приглашений, кампании и активной сцены, папок, токенов и владельцев,
JSON листов dnd5e/mob, HP, ресурсов, инициативы, сообщений и бросков,
стен, дверей, FoW и указателей медиа. Семантика поиска кампании,
пользователей и сессий проверяется через AsyncSession и модули PB-09A.
Проверяются байты исходных файлов, ключ и медиа цели, а также
отсутствие hardlinks между экземплярами.

Отрицательные тесты включают настоящий hot rollback journal, чистую
WAL-базу после checkpoint, конкурирующую блокировку назначения и появление
каталога цели перед публикацией. Покрыты частичная инициализация,
несовместимый каталог, отказ backup/copy/stamp, расхождение ownership, сбой
fsync после публикации и аварийный выход перед stamp. Проверки backup,
restore и retention покрывают валидный manifest с чужой ревизией или drift
и полный цикл восстановления точных Alpha и current.
[Тесты Restore](../server/tests/test_instance_restore.py)
· [Тесты retention](../server/tests/test_automatic_backup.py)
В тесте с разными mount ID граница смоделирована. Реальная публикация
проверяется отдельно на поддерживаемом локальном mount.
[Тесты подготовки](../server/tests/test_alpha_upgrade.py)
· [Тесты startup и hot journal](../server/tests/test_storage_preflight.py)
· [Тесты storage locks](../server/tests/test_storage_lock.py)
