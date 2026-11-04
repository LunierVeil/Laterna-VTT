# FSD-09a — системные проекции и статическая композиция

Статус: реализация текущего PR; merge требует отдельного разрешения владельца.
База — master `321d80309c4e7563dabb8bd5b579bd388cf2c63f` после FSD-08a/08b.
Архитектура следует [D1–D7](FSD_MIGRATION_PLAN.md#6-согласованные-adr-d1d7) и
[границе состояния D5-v2](ADR_STATE_BOUNDARY.md). Lifecycle 08b не переписывается.

## Ответственность

Универсальные SceneView, TokenCard и InitiativePanel не импортируют D&D definitions,
rules или UI. App передаёт стабильные callbacks/slots через существующий TablePage.
Система получает доступные клиенту Character/SelectedToken и возвращает проекцию
или намерение изменения. Она не читает store, не отправляет команды и не владеет
PixiJS. Сервер остаётся источником сохранённого состояния, прав и результатов бросков.

| Модуль | Назначение |
| --- | --- |
| [definition.ts](../web/src/entities/character/model/definition.ts) | Чистые CharacterDefinition/CharacterPresentation, inspector view и HealthChange; не wire DTO |
| [presentation.ts](../web/src/entities/token/model/presentation.ts) | Единственный прежний CharacterStats: optional hp/max/badge/speed |
| [project-stats.ts](../web/src/entities/token/lib/project-stats.ts) | Map только из переданных видимых records; projector передаётся явно |
| [health-slot.ts](../web/src/entities/character/ui/health-slot.ts) | UI types отдельно от чистого model: current/max/onSet и resolver ComponentType |
| [definitions.ts](../web/src/systems/dnd5e/model/definitions.ts) | PC/NPC проекции и прежний HP patch; legacy d20 presentation |
| [tokenStats.ts](../web/src/systems/dnd5e/model/tokenStats.ts) | Каноническая schema-parameterized characterStatsFor и at, без registry lookup |
| [registry.ts](../web/src/app/systems/registry.ts) | Единственная композиция definitions для универсальных потребителей; ключи dnd5e/mob |
| [ui-bindings.ts](../web/src/app/systems/ui-bindings.ts) | Стабильные системные HP slots; pure registry не импортирует React UI |
| [HpControls.tsx](../web/src/systems/dnd5e/ui/HpControls.tsx) | Прежний системный UI leaf, перенесён без изменения тела |

Registry — закрытая статическая Map, не public mutable registration API. Unknown,
включая inherited object names, возвращает undefined; default-dnd5e не вводится.
Оба wire keys относятся к существующей D&D реализации. Это не поддержка новой НРИ
на сервере. Plugin SDK, loader, aliases, дополнительные providers/stores отсутствуют.

## Потоки

1. App импортирует bindings; TablePage передаёт SceneView только tokenStats callback,
   TokenCard — inspector/health callbacks и health-control resolver, InitiativePanel —
   initiative projection/formatters. Нижние слои не импортируют app registry.
2. SceneView строит прежний Map и вызывает setCharacterStats. SceneStage implementation
   и constructor callbacks прежние. Stable projector включён в зависимости двух
   эффектов, его identity не меняется при snapshots/командах/рендерах.
3. TokenCard показывает готовый subtitle/badge/stats. HealthChange выбирает прежний
   character.update {id,set} либо token.update {id,hp}; отправляет host с текущими ids.
   Абсолютный next формируется прежним HpControls; generic damage engine не вводится.
4. InitiativePanel сохраняет текущие подписки и imperative чтение characters при
   действии. Adapter возвращает бонус и подписи; combat.roll {entry_id,bonus}, права,
   ручное поле Enter/blur и порядок событий прежние. RNG находится на сервере.

## Сохранённые особенности

- dnd5e/mob, schema.id, JSON paths, Token.hp и DTO не преобразованы.
- PC temp HP поглощают урон; лечение с <=0 сбрасывает прежние death flags через
  hpChanges. Min/max, manual HP base, целые ±N, amount draft и durations не менялись.
- Mob inspector при hp=null сохраняет undefined, а Stage fallback — максимум из
  шаблона. Эти разные legacy semantics намеренно не унифицированы.
- Badge/speed parsing и optional numbers прежние. Speed/измерения пока в футах.
- Unknown definition не создаёт stats/HP controls. CharacterSheet сохраняет свой
  прежний unknown-system fallback; его renderer не переносился.
- Все useUi subscriptions (19 consumers, 3 whole-store hooks), React keys и
  имена/ключи WS payload сохранены. Никаких per-frame координат в Zustand.
- HpControls component types находятся на module scope: нет inline component
  factories или нового key, который сбрасывал бы input drafts.
- Backend combat.roll остаётся 1d20+bonus. Это явный legacy combat adapter,
  не обещание универсальной инициативы для произвольных НРИ.

## Точный allowlist до FSD-09b

| Оставшийся consumer | Почему остаётся |
| --- | --- |
| [CharactersPanel](../web/src/features/character-management/ui/CharactersPanel.tsx) → tokenStats.at | Catalog UI, PC/mob classification, поля/подписи и LSS будут отделяться в 09b |
| [CharacterSheet](../web/src/widgets/character-sheet/legacy/CharacterSheet.tsx) → SHEETS/bonus/HpControls | Большой stateful renderer и host ещё не разделены; в 09a изменён только импорт HP leaf |
| [Cards](../web/src/widgets/character-sheet/legacy/Cards.tsx) → bonus.totalWeight | Часть legacy renderer family до 09b |

SHEETS остаётся **только legacy schema lookup для CharacterSheet** в dnd5e.ts,
ссылаясь на те же dnd5e/mob constants. Это временное исключение, не второй resolver
для универсальных widgets. Старые characterStats/statsOf wrappers удалены после
переключения последнего consumer; расчёты не дублируются. Старого sheets/HpControls
пути и compatibility re-export нет — оба caller обновлены атомарно.

Архитектурный scope 09b предварительно согласован, **реализация не разрешена**:
сначала merge/проверка 09a и отдельное разрешение. Перенос renderer family/catalog,
его Context/lazy DocEditor/drafts/layout не выполнялся. Другие исключения, включая
shader cache Issue #16, не исправлялись. ROADMAP/Beta UX, backend/БД, протокол,
PixiJS runtime, CSS и зависимости не менялись.

## Проверки

Characterization и definition tests закрепляют optional HP/max, badge 0/empty,
speed parsing, доступный Map, unknown keys, различие mob HP, temp HP и healing patch.
UI tests исполняют реальный HpControls и проверяют стабильную identity slots.
Architecture tests проверяют imports, точный allowlist, отсутствие доступа system
code к store/transport и единственность прежнего CharacterStats. Общие graph tests
по-прежнему отвергают runtime/type-only cycles.

Новый отдельный [Chromium initiative test](../web/tests/browser/initiative.test.mjs)
проверяет owner/GM add/roll, исходящий payload, коррелированный cmd_id результата,
die в 1..20 и init=die+bonus, UI result, server permission rejection, fallback 0
для unlinked/missing bonus и сохранение Stage/canvas identity. Конкретное случайное
значение d20 не фиксируется. Unknown system проверяется unit-тестом, без обхода
серверного ограничения допустимых system keys.

Сохранены все прежние 35 browser cases/assertions/timeouts. Interaction увеличен
14→15, общий набор 35→36; [manifest](../web/tests/browser/run.mjs) и
[gate](../scripts/ci_gate.py) согласованы. Новый regression отвергает прежний count
14; SHA/run/attempt, missing/skipped/failed/stale checks не ослаблены.

Каждый логический коммит: TypeScript, профильные tests и Fast CI точного SHA до
следующего шага. Готовый PR: frontend/backend, Chromium 8/8/5/15, строгий CI required
на актуальном test merge. Merge требует отдельного разрешения; Fast CI его не заменяет.
