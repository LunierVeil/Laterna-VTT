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
