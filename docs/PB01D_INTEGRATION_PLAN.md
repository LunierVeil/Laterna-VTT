# PB-01d — завершение вычислительного этапа и план интеграции

База: master `baa7695ff4654c3317cd5143b05fd7bf8cba83d0` после обычного
[merge PR #37](https://github.com/LunierVeil/Laterna-VTT/pull/37).
[Full CI master](https://github.com/LunierVeil/Laterna-VTT/actions/runs/42112696994)
успешен: backend/frontend, Chromium 9/8/5/16 (38), CI required; история трёх
коммитов PR #37 сохранена. Это docs-only результат для **Owner Review**, не разрешение runtime.

## Завершено — только изолированный экспериментальный scope

| Этап | Результат | Сохранённая граница |
| --- | --- | --- |
| [PB-01d-1](PB01D_VISIBILITY_AREA.md), [PR #35](https://github.com/LunierVeil/Laterna-VTT/pull/35) | Событийный approximate_zero_width contour, exact point truth | Не маска FoW/авторизации/раскрытия объектов; не интерактивный массовый расчёт |
| [PB-01d-2](PB01D_BASIC_LIGHTING.md), [PR #36](https://github.com/LunierVeil/Laterna-VTT/pull/36) | Бинарный point light, explicit ambient, OR источников | Нет реальных source records, mapping старых полей или игровых правил зрения |
| [PB-01d-3](PB01D_COMPUTATION_CONTEXT.md), [PR #37](https://github.com/LunierVeil/Laterna-VTT/pull/37) | Immutable context, локальные бюджеты/отмена/поколения, SQLite probes | Нет trusted DB source adapter, глобального scheduler или безопасной сетевой публикации |

Все три этапа прошли review **PASS WITH RISKS** в этих границах. Динамический свет
в игре, automatic FoW, авторизация видимости и визуальный renderer **не готовы**.
D10/D11 для runtime, W3 и source mapping остаются OPEN; performance SLA отсутствует.
Старые API/БД/игровой код этим документом не меняются, ROADMAP/LTR-DEC/G1–G6 не переутверждаются.

## Решения владельца — всё ниже PROPOSED

| Gate | Рекомендация | Что ещё утвердить |
| --- | --- | --- |
| D10: admission | Общий scheduler приложения, fairness между участниками, bounded admission и coalescing последнего запроса по доверенному ключу сцены/наблюдателя; без глобального кеша геометрии | Workers, N/S/Q/bytes, queue и time budgets — после Windows-измерений |
| D10: busy/отмена | Отменять старые jobs; освобождать capacity только после фактического выхода CPU. Busy/timeout не разрешают новые protected payload или старую видимость как lease | Retry/backoff, безопасный статус и отзыв recipient view; не fallback CLEAR |
| D10: CPU | Сравнить thread baseline с ограниченным process pool: GIL, Windows spawn/IPC, RSS, crash/restart. Hard stop требует процесса, не убийства Python thread | Изоляция и fault policy; существующий runner не production scheduler/SLA |
| D11 | Первый тест — один authoritative writer/coordinator, без online raw-SQL/import. Capture и окончательный publication fence разделены | Поддержка внешних live writers, физические версии и точка линеаризации доступа |
| D05/D06 | Явные scene-scoped источники: world-point либо token anchor в текущем x/y без сдвига сетки, положительный radius в px; enabled отдельно от READY/ON_OBSTACLE. Ambient задаёт ГМ | Source mapping, DDL, save/restart, offset и права редактирования. Никакой автотрактовки/backfill emits_light/vision_range или неявного default |
| PB-02 / M1 | Для теста: личный обзор из одного принадлежащего игроку PC, центр→центр; свой PC доступен для управления, ГМ видит разрешённую сцену | Observer/target policy и исключения. W3, несколько owned tokens, shared vision, darkvision и память разведки остаются отдельно OPEN |

### D11: предлагаемый путь capture → compute → publication

Доверенная session определяет actor/campaign/scene/observer. Одна **физическая** read
transaction читает Scene/Wall, observers/targets и разрешённые sources отдельными
SELECT, без walls×sources JOIN. Reuse чистого prepare_scene_geometry; scene_sight
на каждый источник открывает разные sessions. Проверить также ORM selectinload:
legacy AsyncSession сам по себе не snapshot; BEGIN/WAL проверен только экспериментом.

Закрыть read transaction перед CPU. Затем заново проверить полный state/recipient
version под writer/publication fence: geometry/light digest **и** session/role/scope
epochs, не только seq. Changed/ABA/logout/scene mismatch — discard. Очищенную
projection принять в ordered outbound без await-окна; transport соблюдает recipient
epoch и отзывает неподанные старые frames. Не держать SQLite transaction на send.
Уже законно доставленную информацию нельзя «забыть» удалением токена.

**Внешняя SQL-запись:** hash/PRAGMA data_version — сигналы инвалидации, не защита
race до send и не сертификат истории ABA. Если нужен поддерживаемый live writer
вне coordinator, необходим DB-enforced revision/writer barrier с конкурентными
тестами; persisted counter/trigger требует отдельного решения и migration gate.
Необнаруженный обход fence не объявлять защищённым. Неожиданная запись — остановка
protected выдачи/egress до нового trusted capture. Object identity не freshness.

## Windows-измерения до утверждения D10

Owner определяет минимальный host/OS/RAM/CPU; проверять целевой Python/dependencies,
LAN/Porthole, без запуска release workflow. Синтетические данные, не живая партия:

- Холодный старт и steady-state/soak: 30/200/15 как baseline, большие карты,
  узкие проходы/почти параллельные стены, несколько игроков, move/door/source burst,
  reconnect и медленный клиент. Этот профиль не автоматически SLA.
- Раздельно DB capture/materialization, validation/hash/preparation, admission/queue,
  IPC/point queries, revalidation/projection/outbound; CPU, RSS/private bytes, peak,
  event-loop lag и время до **фактического** освобождения отменённого worker.
- Threads/processes, startup/restart, длинные атомарные операции; воспроизводимые
  p50/p95/p99 по достаточным независимым повторам, а не максимум трёх прогонов.
  По отчёту Owner выбирает лимиты, включая metadata bytes/numeric complexity,
  overload/retry и hard-stop policy. EPYC-результат не переносится в production SLA.

## Последовательность будущих PR

[ROADMAP](ROADMAP.md) и [Beta-решения](BETA_DECISIONS.md) сохраняют A→E.
**До первой новой таблицы/несовместимого JSON вставить необходимую часть B:** DataHome,
проверенные backup/restore и Alpha upgrade, Alembic. Это касается revision/media/source
records; DDL сейчас не выбирается. Каждый scope согласовать отдельно, ядро не переписывать.

| PR | Результат | Gate |
| --- | --- | --- |
| I-01a | Windows report без runtime | Owner утверждает D10 policy |
| I-01b | Bounded global scheduler/CPU adapter | burst/busy/cancel/crash, отсутствие event-loop math/просроченной очереди |
| I-02 | Trusted snapshot/version + coordinator/publication fence; без source DB adapter | legacy/BEGIN, commit/rollback/external write без seq, ABA, role/session/scene races; без согласованного fence — стоп |
| I-03 | PB-02 периметр M1: общая permission/projection для REST/snapshot/WS/resync, preview, combat/linked references и media | GM/player/owner/anonymous/чужой scope; отсутствие утечек IDs/имён/полей/URL; GAP /uploads заменить denial-regression |
| I-04 | Игровой LOS-срез M1 ниже | согласованный recipient-delta/отзыв при pending, seq/cmd_id/noop/reconnect сохранены; WS-контракт утвердить отдельно |
| I-05 | Явные scene/token источники, сохранение и бинарный свет | D05/D06 + migration gate; source bind/move/delete, двери/privacy; G∩L для обычного зрения — только после Owner-решения |
| I-06a | Разрешённая визуальная маска/renderer | контракт точности/нагрузки; approximate_zero_width не маска FoW/authority, секретные walls/sources не отдавать ради PixiJS |
| I-06b | Automatic FoW и сохраняемая разведка | personal/shared memory, сериализация/migration; память карты не раскрывает нынешние скрытые объекты; отдельный PR от renderer |

PB-02 защищает данные, не только картинку. Internal ContextVersion и полный capture
не клиентский DTO. Существующие scene_snapshot/event_for/token_for — точки
совместимости, не новый AccessPolicy. Не слать независимые изменения с повторным seq
и не использовать fog.updated как неутверждённый LOS-протокол. При перегрузке
protected updates отзываются/блокируются; публичный фон и управление своим PC не
равны разрешению видеть цели. M1 не закрывает весь PB-02 для всех материалов.

## M1 — минимальный первый срез непосредственно в игре

**Предложение, не разрешение реализации.** После I-01–03 и Owner-gates — явно
включаемая тестовая сцена: ГМ, два игрока с одним PC у каждого, NPC за обычной стеной
с дверью; explicit ambient full, пустой ручной FoW. Нет persistent ламп/новой маски.

1. У ГМ NPC виден; у игрока за закрытой/запертой дверью его нет в DOM/SceneStage,
   HTTP/WS/resync/preview/связанных private данных. Скопированный protected image URL
   запрещён. Чужой PC нельзя назначить своим observer.
2. ГМ открывает дверь: только разрешённый получатель получает NPC. Закрывает —
   актуальная projection отзывает NPC. Late open-result после close не возвращает его.
3. Busy/timeout, observer-on-wall, scene change/logout/reconnect не дают «видно всё»
   или возврата старого view; ГМ получает диагностику, игрок — безопасный статус.
4. Сохранены movement/ownership/HP privacy, seq/cmd_id и 38 существующих Chromium
   cases плюс согласованные security/race tests; Full CI test merge и master.

Срез доказывает серверный LOS для ограниченного теста, не завершает свет, automatic
FoW, renderer, весь PB-02 или Beta C. Сейчас требуется Owner Review D10/D11,
source mapping и политики M1; runtime-код в этом docs-only изменении отсутствует.
