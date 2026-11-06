# PB-02 — ограниченная игровая LOS-интеграция

База: `9493efc72e23e43c574db1167d1e3a0e1c7da2d3`, после #39.
Design note первого функционального среза, не новый rules engine или утверждение
всех D10/D11/W3. [Scope предыдущего среза](PB02_PERMISSION_PROJECTION.md).

## Policy до реализации

- Флаг `LANTERNA_EXPERIMENTAL_VISIBILITY=1`, по умолчанию выключен.
- Наблюдатель: ровно один не-GM-layer token текущей сцены, принадлежащий actor,
  связанный с `dnd5e` Character того же владельца/кампании. Позиция — центр token.
  Нет выбора «первого» из нескольких PC, shared vision или mob-наблюдателя.
- Цель: центр чужого токена. Слой GM и manual FoW проверяются дополнительно;
  CLEAR не отменяет entity/recipient permissions. Свои не-GM-layer токены
  сохраняются для управления, но не дают исключения для чужих NPC.
- Только `PreparedGeometry.point_sight()` и существующий adapter обычных стен и
  дверей. Open пропускает, closed/locked блокируют. W3 и другие виды препятствий
  не выбираются: unsupported geometry закрывает выдачу чужих токенов.
- Ноль/несколько PC, observer on obstacle, invalid input, busy/timeout/budget —
  own-only projection; никогда all-visible. Ambient full здесь означает лишь
  отсутствие дополнительного lighting restriction; LightingField/старые поля
  emits_light/vision_range не подключаются и не переинтерпретируются.

## Ограничения вычисления и согласованность

Временный экспериментальный профиль: до 32 captured tokens (собственные первыми),
200 стен, 1 MB capture и 0.5 s ожидания CPU. Один bounded worker без очереди;
при отмене capacity освобождается только после фактического завершения работы.
Это не production SLA, hard isolation или global scheduler. Целевой baseline
30 tokens/200 walls помещается в профиль; большее число записей fail-closed.

Immutable capture копирует geometry, tokens и linked character metadata; stamp
включает и поля payload, не только seq. CPU вне event loop. После расчёта сверяются
fresh session/role/scope и повторный DB capture; stale результат не публикуется.
Существующий scene lock упорядочивает команды и их публикацию; read transactions
не удерживаются на network send. Свой текущий projection не является вечным lease.
Не заявляется атомарная защита произвольного внешнего writer между последней
проверкой и hand-off в transport, межпроцессный coordinator или hard CPU stop.

## Порядок безопасных коммитов

1. Capture/policy и regression tests без runtime callers: промежуточный коммит
   сохраняет прежнее поведение и не создаёт частично защищённый периметр.
2. Подключение всех existing recipients/REST/WS/media/preview и bounded fresh
   publication, без нового message type. Existing snapshot обновляет проекцию,
   существующее event сохраняет seq/cmd_id; full snapshots не источник roll animations.
3. Chromium игрового сценария, конкурентные negative tests и инструкции проверки.

Нет PB-03 renderer, PB-04 editor, persistent sources/exploration, DDL или миграций.
Новый incompatible persisted scope требует необходимого migration gate заранее.
ROADMAP/BETA_DECISIONS/CI не изменяются. Итог оставляется Draft для независимого review.

## Реализованный transport/perimeter

`scene_snapshot()` снимает согласованный physical SQLite read capture, отпускает
transaction перед CPU и повторно проверяет stamp/session/role/scope. Для snapshot
и scene events WebSocket
stamp хранится только как внутренний Python attribute, не как JSON/wire field;
перед hand-off повторно проверяется текущий capture. Initial snapshot до join
проходит ту же проверку. Два несовпавших capture означают отказ, не выдачу старого.

При scene event каждому игроку строится собственная проекция. Сначала идёт
существующий event/ack с исходными `seq`/`cmd_id`, затем, **только при изменении
набора разрешённых token IDs**, существующий `snapshot` с тем же committed seq.
Скрытые update/add превращаются в noop; известный отозванный ID — в remove.
Combat entries и current фильтруются; manual FoW/GM layer проверяются дополнительно.
Команда и preview повторно проверяют session/role/active scene после ожидания
scene lock: результат проверки до очереди не является разрешением на запись.
При ошибке построения projection соединение закрывается вместо отправки payload.

Обычные перемещения без смены разрешённого набора не пересоздают stage snapshot.
При смене набора existing `setSnapshot` сохраняет доступное выделение и локальные
черновики, но сбрасывает transient drag/preview. Wall changes также отзывают
старые preview; новый preview требует видимости origin **и** destination.

REST, initial/reconnect/resync, scene event fanout, known-ID mutation checks и
защищённые uploads используют эту policy. Media ACL держит короткий physical read
snapshot во время bounded CPU, закрывая его **до** отправки байтов; это может
кратковременно задержать writer. CPU timeout не является hard worker cancellation.
Доступность изображения — объединение всех разрешённых ссылок: общая картинка,
разрешённая другим видимым объектом, не становится секретной из-за скрытого NPC.
Уже полученные клиентом байты невозможно «забрать обратно»; отзыв защищает новые
запросы и убирает объект из штатного представления.

## Автоматическая и ручная игровая проверка

Backend regression tests:
[policy](../server/tests/test_gameplay_visibility.py),
[REST/WS/media/concurrency](../server/tests/test_gameplay_projection.py),
[предыдущий security perimeter](../server/tests/test_pb02_projection.py).
Барьерные тесты меняют дверь после CPU/preparation, **без изменения seq**, и
проверяют отклонение устаревшего результата. Проверяются движение observer/target,
personal vision, closed/locked/open, инициатива, preview и отказ при ошибке projection.

Из `web`, при установленном Chromium и зависимостях проекта:

```bash
LANTERNA_EXPERIMENTAL_VISIBILITY=1 CHROMIUM_PATH=/usr/bin/chromium \
  node --test tests/browser/gameplay-los.mjs
```

[Standalone probe](../web/tests/browser/gameplay-los.mjs) поднимает собственные
временные backend/DB/uploads и Vite. Три настоящих SPA/Pixi клиента: ГМ, два
игрока с одним PC. ГМ кликает существующую дверь на canvas; проверяются появление,
отзыв NPC, отсутствие secret ID в начальных WS frames, отказ media/Range, приватность
NPC sheet, reconnect и смена активной сцены. Наблюдается настоящий SceneStage,
без подмены projection или fake canvas. Синтетические данные удаляет fixture.

**Ограничение CI:** probe пока автономен и не добавлен в основной browser manifest.
Изменения CI/expected counts не разрешены этим заданием. Новые backend tests
входят в all-pytest/Fast CI; прежний required browser gate сохранён. Включение
нового probe в обязательный gate требует отдельного согласования владельца.

Для ручной проверки на CachyOS запустить `LANTERNA_EXPERIMENTAL_VISIBILITY=1 ./dev.sh`,
создать чистую тестовую сцену с двумя PC (по одному у каждого игрока), NPC и стеной
с обычной дверью. Поставить первый PC перед дверью, NPC за ней; второго PC можно
поставить на сторону NPC, чтобы проверить независимость проекций. Не включать
ручной туман поверх NPC, не помещать NPC на GM layer. Открыть/закрыть/запереть
дверь существующими инструментами и проверить NPC у каждого игрока, затем
переподключиться и переключить активную сцену. Поле ambient не добавляется:
в этом геометрическом срезе дополнительное ограничение света отсутствует.

## Оставшиеся ограничения

- Флаг выключен по умолчанию; legacy public uploads при flag off остаются AS-IS.
- Нет нескольких наблюдателей, shared vision, range/darkvision, W3, lighting/FoW
  renderer или сохраняемой разведки. Эти решения не утверждены этим срезом.
- Нет production SLA, hard CPU/memory isolation или multi-process publication fence.
  Отдельные запросы могут получить own-only при занятом worker; следующий успешный
  snapshot/event восстанавливает разрешённую проекцию. Автоматического retry по
  окончании worker нет. Профиль рассчитан на ограниченную тестовую сцену.
- Ограничение по rows/bytes проверяется на capture; это не лимит размера всей БД
  и не доказательство защиты от произвольного внешнего writer после final check.
- Полнота PB-02 требует независимого review. Успешный автоматический probe не
  подменяет ручную приёмку владельцем на CachyOS.

## Локальная проверка реализации

Linux, Python 3.12.14, Node 24, системный headless Chromium; только временные
синтетические данные. Полный backend: **576 PASS**; frontend unit: **22 PASS**;
TypeScript и production build: PASS; structure/safety: **31 PASS**; Markdown
links/fragments: **326 PASS**; diff-check: PASS. Новых relative-import cycles
в `server/app` относительно базы не найдено.

Legacy flag-off Chromium: tokens **8/8**, scenes **5/5**, без skipped/cancelled.
Итоговый opt-in gameplay probe с scene switch прошёл в двух независимых чистых
запусках (42.9 s и 27.4 s; это длительность теста, не latency/SLA LOS).
Полный Full CI test merge ещё не подтверждён: реализация публикуется Draft для
независимого review. Fast CI каждого логического коммита проверяется отдельно.
Предупреждения: существующие FastAPI/Starlette httpx deprecation и Vite chunk size;
тесты/таймауты/gate для их обхода не менялись.
