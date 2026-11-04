# FSD-09 — системные проекции, renderer family и статическая композиция

Статус: FSD-09a объединён в PR #24; FSD-09b реализован в текущей ветке.
Merge FSD-09b требует отдельного разрешения владельца.
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
  прежний unknown-system fallback; renderer перенесён в 09b без смены schema semantics.
- Существующие selector subscriptions и 3 whole-store hooks, React keys и
  имена/ключи WS payload сохранены. Никаких per-frame координат в Zustand.
- HpControls component types находятся на module scope: нет inline component
  factories или нового key, который сбрасывал бы input drafts.
- Backend combat.roll остаётся 1d20+bonus. Это явный legacy combat adapter,
  не обещание универсальной инициативы для произвольных НРИ.

## FSD-09b: connected hosts и system UI

База 09b — master `6d8a9fb89e87c4b2a303115d8cb944fe78688efc`, после зелёного
[Full CI master 09a](https://github.com/LunierVeil/Laterna-VTT/actions/runs/41815275703).

```text
app/systems/ui-bindings.ts              стабильная композиция UI slots
entities/character/ui/
  sheet-port.ts                        callbacks, props, resolver; без schema/store/socket
  catalog-slot.ts                       реальные root/list/row contracts
widgets/character-sheet/
  ui/CharacterSheet.tsx                 state/public, upload и подключение callbacks
  model/sheet-actions.ts                прежние команды через supplied send
features/character-management/ui/
  CharactersPanel.tsx                   connected root/list hosts, прежние подписки
  SheetRow.tsx                          права, linkedTokens, ConfirmDialog, drag MIME
systems/dnd5e/ui/
  CharacterSheets.tsx                   dnd5e/mob bindings и unsupported chrome
  CharacterCatalog.tsx                  PC/mob classification, LSS/каталог presentation
  legacy/                              View, Cards, SpellBook, RichText, DocEditor,
                                       richDoc, единственный sheetOps Context
```

- Прямой legacy allowlist пуст. Только app/systems импортирует systems извне.
  `SHEETS` и неиспользуемый mob import удалены; pure registry не импортирует React.
  UI resolver использует те же определения dnd5e/mob; неизвестный ключ возвращает
  undefined, app явно предоставляет прежний unsupported view без schema.
- Host листа получает accounts/isGm через прежние selectors и переводит callbacks
  в прежние character.update/list/counter/delete/reimport, chat.say и dice.roll.
  Roll читает текущие isGm && hiddenRolls при действии; max_path по-прежнему опущен,
  если не задан. Portrait limits 25/5 MiB, 2048 px и сообщения ошибок сохранены.
- Catalog root сохраняет kind локально; unknown records остаются в PC-списке.
  Conditional list hosts сохраняют accounts/isGm и placeHidden subscriptions в
  прежних mount branches. Row render callback возвращает SheetRow key=character.id,
  а не создаёт inline ComponentType. System view передаёт mob deletion suffix;
  permissions, linkedTokens и безопасный Cancel остаются в feature.
- PC create по-прежнему не передаёт system, mob create передаёт mob. LSS читается
  как source с прежним лимитом 512 KiB; copy, placement/freeCellNearCenter, hidden
  layer, drag MIME и данные сохранений не преобразованы.
- TablePage key=openCharacter.id сохранён. Stable module-scope sheet slots не
  размонтируют view на event/snapshot/reconnect. Editing/tab/query/confirms, drafts,
  refs, card expanded state, onlyPrepared и localStorage key остаются локальными.
  Новая persistence после закрытия листа или размонтирования вкладки не вводится.
- Provider/useSheetOps используют один Context. Два module-scope lazy DocEditor
  imports остаются прежними; TipTap/resources/XSS sanitizers не переписывались.
- Тела Cards, SpellBook, RichText, DocEditor и richDoc, 17 неизменяемых helpers
  CharacterSheet и все 35 JSX keys листа совпадают с базой по AST без imports.

## Сохранённые ограничения

Legacy sheet DSL всё ещё D&D-oriented в entities/character/model; его перемещение
или универсализация не входят в 09b. HpControls остаётся системным UI. Unsupported
chrome находится рядом с прежним renderer, но не выдаёт неизвестную систему за
D&D. UUID в Cards — единственное узкое исключение system guard для существующих
клиентских card IDs: c- + первые 12 символов randomUUID, legacy row-i fallback
сохранён. Это не игровой RNG; model/game RNG и transport/store доступ запрещены.

Нет plugin SDK, loader, дополнительных stores/providers, dynamic registry или
изменения серверной поддержки НРИ. [Shader cache Issue #16](https://github.com/LunierVeil/Laterna-VTT/issues/16)
не исправлена. ROADMAP/Beta UX, backend/БД, protocol, PixiJS runtime, CSS и зависимости
не меняются. Этапы после 09b не начинаются автоматически.

## Проверки FSD-09a (сохранённый контекст)

Characterization и definition tests закрепляют optional HP/max, badge 0/empty,
speed parsing, доступный Map, unknown keys, различие mob HP, temp HP и healing patch.
UI tests исполняют реальный HpControls и проверяют стабильную identity slots.
Architecture tests проверяют imports, пустой legacy allowlist, отсутствие доступа system
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

### Дополнительные regression tests 09b

[Sheet lifecycle](../web/tests/browser/sheet-lifecycle.test.mjs) подтверждает lazy
loading только при editing, неизменный DOM view/input/editor и несохранённые name,
quantity/doc после character event, смены сцены и reconnect; явный save сохраняет
прежний card ID и rich document. Context list/counter проверяется по фактическому
исходящему payload, серверному character и клиентской проекции. После character.list
ожидается свежий snapshot/connected: backend уже на базе публикует tokens_refresh;
клик в retry не является корректной проверкой отправки следующей команды.

[Catalog](../web/tests/browser/catalog.test.mjs) проверяет UI create PC/mob, copy,
placement, owner/GM visibility, Cancel focus, mob deletion impact и detach на обоих
клиентах. Оба теста прошли на исходном runtime до extraction. Произвольных sleep,
глобальных timeout increases и изменений прежних 36 cases нет.

Итог 09b: sheets 9, tokens 8, scenes 5, interaction 16 — 38 Chromium cases. Manifest,
expected counts и строгий gate согласованы; regression gate tests отвергают старые
counts, missing/skipped/cancelled/stale результаты по-прежнему запрещены. Node SSR
тесты исполняют реальные slots с CSS no-op только в test loader; runtime CSS сохранён.
