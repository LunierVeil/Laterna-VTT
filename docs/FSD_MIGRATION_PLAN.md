# FSD Stage 1 — целевая архитектура и план миграции

## Статус и границы

План миграции к базе `1b215596cb9cb1917ba8fce3f249d1c7789d2df5`.
[AS-IS, evidence и классификация проблем](FSD_AUDIT.md).
D1–D7 согласованы пользователем 03.11.2026 как направление миграции; принятые
ADR и ограничения зафиксированы в разделе 6. Это не разрешение на выполнение
переносов. Ни один описанный ниже перенос не выполнен. Stage 2 не начинается до
объединения документации в master и отдельного задания. Новый commit/push и создание
PR документации требуют отдельных разрешений; merge не выполняется автоматически.

Цель — уменьшить область влияния изменений и подготовить несколько НРИ, сохранив D&D 5e как
полноценный эталон. FSD здесь — направления зависимостей и ownership, не обязательное
число папок. Структура не заменяет контракты, серверную валидацию и регрессионные тесты.
Планы multi-system дополняют прежний [roadmap](ROADMAP.md), где другие системы
отнесены в «После 1.0», но не обещают срок второй системы и не меняют scope беты.
Book System, router, plugin loader, marketplace, runtime SDK, FastAPI decomposition,
новые dependencies, DB migrations и wire protocol не входят в эту миграцию.

## 1. Направления зависимостей

```text
app → pages → widgets → features → entities → shared
```

Стрелка — разрешённое направление; можно пропускать слои. Не создавать wrapper
лишь ради прохождения через каждый слой. Public API slice нужен при реальном
внешнем потребителе; внутренние relative imports допустимы.

- **app:** bootstrap, providers, runtime session, единая композиция UI store,
  routing серверных событий, wiring policies/commands/projections.
- **pages:** существующие условные access/table screens и layout композиция widgets;
  не новый router и не новый URL contract.
- **widgets:** самостоятельные части стола: canvas, sidebar, token inspector,
  sheet overlay, combat tracker, header. Не game rules и не transport engine.
- **features:** пользовательские операции и функциональный UI: chat/dice,
  character/scenes/player management, token controls, scene tools, access.
  Не отдельная feature на каждый setter/button.
- **entities:** небольшие доменные contracts/projections/selectors: session,
  character, token, scene. Не дублировать все wire DTO и не создавать пустые entity
  для каждого interface. Render models без React/Pixi/SceneSocket instance.
- **shared:** существующая Design System, технические helpers и API boundary.
  `shared/api/protocol.ts` — точные wire DTO, а не универсальная бизнес-модель.
  Shared API не импортирует entities/features/store/systems; DTO aggregates допустимы
  как единый внешний контракт. Не объявлять их новую структуру сохранений.

Соседние widgets/features не импортируют друг друга. Для взаимодействия — composition
в page/app, callbacks или нижний domain contract. Допустимое исключение — внутренние
компоненты одной slice; например Sidebar может собирать features/chat и management,
но не отдельные sibling widgets. TablePage собирает sibling widgets напрямую.
Не вводить table-workspace widget, который просто повторит роль page.

### Временная граница legacy

До отдельного Zustand-этапа `web/src/state/store.ts` остаётся на месте, с одним useUi.
Перенесённые потребители могут временно импортировать его как **явно разрешённую
legacy-зависимость**, не как образец FSD. Список исходных consumers есть в AS-IS/графе;
новые зависимости от legacy не добавляются. Те же ограничения для ещё не перенесённых
sheets и ui. Нельзя заявлять отсутствие нарушений слоёв до удаления этих исключений.

Не класть весь store в shared «навсегда», не перемещать его в app с сохранением
upward imports из features и не дробить на независимые stores в PR с imports.
Сначала стабилизируются ownership/lifecycle, затем меняется подключение consumers.

## 2. TO-BE: дерево

Пример целевой структуры после согласованных шагов. Имена slice уточняются перед
конкретным PR; пустые каталоги не создаются. `systems/dnd5e` — согласованная будущая граница НРИ, не стандарт FSD
и не обязательный результат первых переносов. Немедленного переноса не будет.

```text
web/src/
  main.tsx                         стабильный Vite entry, StrictMode/fonts/CSS
  styles.css                       пока прежний cascade; не глобальный редизайн
  app/
    App.tsx                        выбор существующих access/table screens
    session/
      urlCredentials.ts            однократное потребление gm/invite
      useTableSession.ts           socket lifecycle + snapshot/event bridge
    model/
      table-store.ts               один bound Zustand store, позже PR-08
      actions.ts, selectors.ts     без игровых правил и транспорта
    ui/                            connectors: store → widget view props/actions
    systems/registry.ts            статическая композиция definitions, не loader
  pages/
    access/ui/AccessPage.tsx
    table/ui/TablePage.tsx          композиция header/canvas/sidebar/overlays
  widgets/
    scene-canvas/{ui/SceneView.tsx,lib/stage.ts}
    table-header/ui/TopBar.tsx
    sidebar/ui/Sidebar.tsx
    token-inspector/ui/TokenCard.tsx
    character-sheet/legacy/         совместимый renderer и связанный UI, не generic SDK
      CharacterSheet.tsx, Cards.tsx, SpellBook.tsx
      RichText.tsx, DocEditor.tsx, richDoc.ts, sheetOps.ts
    combat-tracker/ui/InitiativePanel.tsx
  features/
    access/ui/Login.tsx
    chat/ui/Chat.tsx
    dice/{ui/DicePanel.tsx,ui/DiceAnimation.tsx,lib/diceDisplay.ts}
    character-management/ui/{CharactersPanel.tsx,SheetRow.tsx}
    scene-management/ui/{ScenesPanel.tsx,MapSettings.tsx}
    player-management/ui/PlayersPanel.tsx
    scene-tools/ui/{ToolRail.tsx,SelectionBar.tsx,ZoomControl.tsx}
    token-controls/                 только при извлечении операций из inspector
  entities/
    session/model/                 identity/affordance contracts, по необходимости
    scene/model/{tool.ts,scene-port.ts}
    token/model/{selection.ts,presentation.ts}
    character/model/               DTO alias, selectors, definition, legacy-sheet-schema.ts
  shared/
    api/{protocol.ts,scene-socket.ts,upload.ts}
    lib/{input/,record-path/}       только доказанно общие helpers
    ui/{Button,TextField,Checkbox,Panel,Tabs,Dialog,Tooltip,Select}/
    ui/{ConfirmDialog,icons}/       compatibility dialog; отдельный от native Dialog
    styles/tokens.css              без перемещений/переназначения legacy aliases
  systems/                         [согласованная будущая граница, не немедленный move]
    dnd5e/
      model/{dnd5e.ts,mob.ts,equipment.ts,bonus.ts,tokenStats.ts}
      ui/HpControls.tsx            после извлечения; дальнейшие system renderers по мере нужды
  state/store.ts                   [только переходный compatibility bridge; удалить в PR-08]
```

Принят вариант B — systems/dnd5e. Рассмотренный вариант A
`entities/character/legacy-dnd5e/` сохраняется здесь как история альтернативы,
но не является выбранной целью миграции. Создание новой границы и перенос
существующих definitions планируются отдельными небольшими PR позднее;
registry остаётся статическим и принадлежит app. Plugin SDK не вводится.

### Зависимости будущего systems

`app → systems/dnd5e → entities/shared`; widgets получают resolved definition и
UI slots из композиции. Domain rules системы не импортируют app, widgets, features,
конкретный useUi или SceneStage implementation. Из systems нельзя отправлять
команду через глобальный socket/store; расчёт возвращает прежний projection/patch.
Если сохранён legacy renderer с прямым импортом definitions, это временное
исключение с конкретным PR удаления, а не новый принцип для универсального widget.

## 3. Таблица перемещений

Левые ссылки — существующие файлы на базе аудита. Правые пути — проект, ещё не
существующие файлы; относительно `web/src`. До разрешения не создавать их.
Префикс `DND/` означает будущий `systems/dnd5e/model` согласно принятому D2. Механический move не меняет export,
JSON key, command payload, CSS class или runtime policy.

| Сейчас | Предлагаемое место / решение | Потребители и imports | PR |
| --- | --- | --- | --- |
| [main.tsx](../web/src/main.tsx) | оставить; позже импорт app/App | Vite HTML и fixture route остаются /src/main.tsx | 04 |
| [App.tsx](../web/src/app/App.tsx) | app/App + app/session; layout → pages/table | main; сохранить bootstrap порядок и module singleton | 04 |
| [types.ts](https://github.com/LunierVeil/Laterna-VTT/blob/1b215596cb9cb1917ba8fce3f249d1c7789d2df5/web/src/types.ts) | shared/api/protocol; Tool отдельно entities/scene/model | 15 src consumers + test-only imports/DTO paths | 01 |
| [store.ts](../web/src/state/store.ts) | оставить на переходе; позже app/model/table-store | 17 consumers, evaluate URLs, diagnostics; соединять через app connectors | 08 |
| [socket.ts](../web/src/shared/api/scene-socket.ts) | shared/api/scene-socket.ts | App runtime, 14 type consumers, socket unit, diagnostics URL | 03 |
| [upload.ts](../web/src/shared/api/upload.ts) | shared/api/upload.ts, сначала как есть | sheet, CharactersPanel, MapSettings, TokenCard | 03 |
| [stage.ts](../web/src/scene/stage.ts) | widgets/scene-canvas/lib/stage.ts | SceneView runtime; остальные зависимости заменить narrow ports/type contracts | 01,05 |
| [SceneView.tsx](../web/src/scene/SceneView.tsx) | widgets/scene-canvas/ui/SceneView.tsx | TablePage; resolver stats передаётся сверху | 05,09 |
| [schema.ts](../web/src/sheets/schema.ts) | entities/character/model/legacy-sheet-schema.ts | нижний совместимый контракт для definitions и renderer; не universal shared DSL | 07a |
| [dnd5e.ts](../web/src/sheets/dnd5e.ts), [mob.ts](../web/src/sheets/mob.ts), [equipment.ts](../web/src/sheets/equipment.ts) | DND/; SHEETS registration → app/systems | CharacterSheet, tokenStats, InitiativePanel, TokenCard, unit | 07a,09 |
| [bonus.ts](../web/src/sheets/bonus.ts) | DND/bonus.ts | sheet, Cards, TokenCard, bonus unit; не в Zustand | 07a |
| [tokenStats.ts](../web/src/sheets/tokenStats.ts) | DND/tokenStats.ts после нейтрального type contract | SceneView, CharactersPanel, TokenCard; at/readPath выделять отдельно | 01,07a,09 |
| [sheetOps.ts](../web/src/sheets/sheetOps.ts), [richDoc.ts](../web/src/sheets/richDoc.ts), [RichText.tsx](../web/src/sheets/RichText.tsx), [DocEditor.tsx](../web/src/sheets/DocEditor.tsx) | widgets/character-sheet/legacy | Cards, SpellBook, CharacterSheet; сохранить context identity и lazy import | 07b |
| [Cards.tsx](../web/src/sheets/Cards.tsx), [SpellBook.tsx](../web/src/sheets/SpellBook.tsx) | widgets/character-sheet/legacy | renderer; пока не shared и не Book System | 07c |
| [CharacterSheet.tsx](../web/src/sheets/CharacterSheet.tsx) | widgets/character-sheet/legacy | App → TablePage; HpControls предварительно извлечён | 02,07d,09 |
| [TokenCard.tsx](../web/src/ui/TokenCard.tsx) | widgets/token-inspector/ui | TablePage; health slot/projection вместо sibling sheet import | 02,06c,09 |
| [Sidebar.tsx](../web/src/ui/Sidebar.tsx) | widgets/sidebar/ui | TablePage; children features без пересоздания Chat | 06a–c |
| [TopBar.tsx](../web/src/ui/TopBar.tsx) | widgets/table-header/ui | TablePage; turns/logout пока внутри slice, извлечение по реальной нужде | 06a |
| [InitiativePanel.tsx](../web/src/ui/InitiativePanel.tsx) | widgets/combat-tracker/ui | TablePage; bonus supplied через definition, сервер combat.* прежний | 06c,09 |
| [Login.tsx](../web/src/features/access/ui/Login.tsx) | features/access/ui | pages/access; GmSetup/Invite/Login сохраняются | 04 |
| [Chat.tsx](../web/src/ui/Chat.tsx) | features/chat/ui | Sidebar; draft, scroll и hidden behaviour прежние | 06a |
| [DicePanel.tsx](../web/src/ui/DicePanel.tsx), [DiceAnimation.tsx](../web/src/ui/DiceAnimation.tsx), [diceDisplay.ts](../web/src/ui/diceDisplay.ts) | features/dice/ui + lib | Chat, TablePage, dice unit; не переигрывать history rolls | 06a |
| [CharactersPanel.tsx](../web/src/ui/CharactersPanel.tsx), [SheetRow.tsx](../web/src/ui/SheetRow.tsx) | features/character-management/ui | Sidebar; stage port и character operations, import LSS остаётся серверным | 06c |
| [ScenesPanel.tsx](../web/src/ui/ScenesPanel.tsx), [MapSettings.tsx](../web/src/ui/MapSettings.tsx) | features/scene-management/ui | Sidebar; GM current vs active, private lazy preview | 06b |
| [PlayersPanel.tsx](../web/src/ui/PlayersPanel.tsx) | features/player-management/ui | Sidebar; invite/pause/reset/delete и pending прежние | 06b |
| [ToolRail.tsx](../web/src/ui/ToolRail.tsx), [SelectionBar.tsx](../web/src/ui/SelectionBar.tsx), [ZoomControl.tsx](../web/src/ui/ZoomControl.tsx) | features/scene-tools/ui | TablePage; small stage ports, не весь widget engine | 05,06b |
| [ConfirmDialog.tsx](../web/src/shared/ui/ConfirmDialog/ConfirmDialog.tsx), [icons.tsx](../web/src/shared/ui/icons/icons.tsx) | shared/ui/ConfirmDialog, shared/ui/icons | SheetRow/PlayersPanel/ScenesPanel/SpellBook и остальные consumers | 02 |
| [input.ts](../web/src/shared/lib/input/useTouchInput.ts) | shared/lib/input/useTouchInput.ts | ToolRail; media/listener cleanup сохранить | 02 |
| [styles.css](../web/src/styles.css) | оставить; scoped extraction отдельно | main и browser fixtures; порядок cascade прежний | не обязательный move |
| [shared/ui](../web/src/shared/ui/Button/Button.tsx), [tokens.css](../web/src/shared/styles/tokens.css) | все 8 компонентов и CSS оставить | только нужные imports при переносе потребителей; без DS migration | сохранять |

Подтверждение полноты: таблица покрывает все 49 TS/TSX source-модулей;
извлекаемые части (HpControls, session bridge, ports) — новые будущие границы,
не якобы уже существующие файлы.

## 4. Минимальные интерфейсы, обоснованные текущим кодом

Это эскизы, не спецификация нового протокола и не список файлов для Stage 1.

1. **Token presentation:** вынести существующий CharacterStats из stage в
   entities/token/model/presentation с прежними hp/max/badge/speed. В первом PR
   не переименовывать поля и не менять форматы данных. Это устраняет type-only
   model → widget зависимость; renderer всё ещё получает Map, не Character JSON.
2. **Sheet resolver:** `resolveSheet(legacyKey: Character['system']): Definition | undefined`.
   Static registry размещается в app. Минимальная Definition использует текущие
   `SheetSchema`, `characterStats(character)` и `initiativeBonus(character)`;
   SheetSchema при этом живёт в entities/character/model как явно legacy DSL,
   не импортируется из systems вверх в entity contract. Это сохраняет направление
   systems → entities; prof/d20/spellbook не объявляются общими для всех НРИ.
   Нет универсального lifecycle/plugin API. UI slots для system-specific controls
   вводятся только при отделении TokenCard от HpControls/5e renderer: app собирает
   их из system UI и передаёт widget как props. Pure Definition не получает React
   component registry; systems не импортирует типы props из widgets.
3. **Sheet commands:** сохранить существующий SheetOpsContext (list/counter/roll)
   как template; рядом с host renderer адаптировать в socket.send. Не строить
   новую command bus или второй transport.
4. **Scene ports:** ровно используемые операции вместо ссылки на class widget.
   Например `TokenAnchorPort.setAnchorListener`, `TokenPlacementPort.freeCellNearCenter`,
   `SelectionPort.removeSelected/clearSelection`, `ZoomPort.zoomBy`,
   `FogUndoPort.noteMyFogCmd`. Contracts ниже widgets; implementations — тот же stage.
   Не открывать приватные Pixi maps как production API. Не менять ref lifetime.
5. **Command sender:** если feature больше не требует connection lifecycle,
   можно передать `Pick<SceneSocket, 'send'>`. Сохранить return cmd_id и третий
   optimistic apply/revert argument; не заменить его упрощённым send:void.
   Сам socket пока остаётся тем же классом, не переписывается под абстракцию.

Не смешивать raw DTO и system meaning. Character.system сейчас содержит и
`dnd5e`, и `mob`; второе — legacy тип NPC-листа, не отдельная НРИ.
Resolver может сопоставить их в памяти одной реализации D&D с PC/NPC variants,
но значения в DTO, server SYSTEMS, JSON paths, mob HP policy и данные БД сохраняются.
Не добавлять новое persisted rulesetId/sheetKind поле в FSD PR.
Unknown key должен сохранять прежний безопасный fallback отображения, не становиться
молчаливо dnd5e. Новый ruleset нельзя создавать до отдельной поддержки backend.

### Универсальность: что отделять, что не обещать

Универсальные возможности — хранение и доставка разрешённого состояния сцены,
геометрия в pixels, token identity/placement/ownership, walls/fog/preview,
чат, серверный dice result, access/session. Инициативный порядок/HP/token badge
уже имеют legacy форму в wire DTO: её сохраняют, не объявляя подходящей любой НРИ.

D&D: ability/proficiency/save/AC, d20 advantage/disadvantage, temp HP/death saves,
spell slots 0–9, spell fields, единицы/5e movement hint, schema paths и LSS mapping.
System projections не получают чужие листы: отсутствие разрешённого Character
должно по-прежнему давать отсутствие приватных HP/AC, а не запрашивать их отдельно.

SceneStage сейчас содержит FEET_PER_CELL и Chebyshev metric. В отдельном policy PR
можно передать pure distance formatter/calculator с прежним default 5e; это только
подпись, не ограничение движения и не новый serialized setting. Изменение units,
grid metric, combat.roll формулы или правил damage требует отдельного решения и
тестов. Backend `combat.roll=1d20+bonus`, allowlist system и NPC HP нельзя обойти
frontend adapter. Следующая НРИ — отдельный вертикальный этап frontend/backend
после этих границ, не только новый JSON schema файл.

## 5. Последовательность небольших PR

### Общая проверка и правила

Каждый PR сверяется с актуальным master, содержит одну цель и явный список imports,
не смешивает rename с redesign/новыми правилами. Diff с rename detection должен
показывать механическое перемещение, если цель — move. Возможный compatibility
re-export указывает только на canonical implementation, не обратно; максимум
следующие 1–2 PR, со списком удаления. Ни второго store, ни копии SceneSocket класса.

Обязательная база: frontend unit, TypeScript, production build, backend pytest,
служебные тесты, browser regression и Full CI PR на актуальном merge SHA.
[Команды](DEVELOPMENT.md), [gate](CI_CD.md), [сценарии](CHECKLIST.md).
Минимальные группы для локального анализа рисков указаны ниже; они не отменяют Full CI.
Текущая browser-база — 8/8/5/14, без skipped/cancelled. Обоснованное добавление
нового E2E требует явного увеличения expected counts в gate/runner/docs; исходные
проверки не удаляются ради сохранения цифры. Контролируемые imports в fixtures
обновляются в том же PR; поломку instrumentation не компенсировать удалением проверок.

| PR | Одна цель и файлы | Изменяемые imports | Главный риск и локальная регрессия | Done |
| --- | --- | --- | --- | --- |
| 00 | зафиксировать принятые D1–D7 и завершить документационный Stage 1 | нет | пути/граф/docs-only scope, CI актуального merge SHA | документация объединена в master; Stage 2 требует отдельного задания |
| 01 | нейтральные contracts: types→protocol, Tool/SelectedToken/CharacterStats и narrow stage ports; маленькие под-PR при необходимости | type consumers из таблицы, socket/stage DTO imports, test DTO imports | type-only не должен стать runtime Pixi import; typecheck/unit + tokens/scenes | интерфейсы wire неизменны, нет upward type edges из models в widget |
| 02 | низкорисковые leaves: icons/input/ConfirmDialog move; отдельно extract HpControls из CharacterSheet в существующий sheets/HpControls до будущего переноса по D2/09 | consumers old ui; TokenCard и CharacterSheet больше не импортируют друг друга | CSS/focus, pointer capability, damage/temp HP; design-system/components-v03, sheets, tokens, ui | прежний API Cancel/Escape и HP commands; не заменять ConfirmDialog новым native Dialog |
| 03 | transport/upload physical move в shared/api | App, 14 type consumers, upload consumers, socket unit и diagnostics URL | один class/prototype, seq/reconnect/old socket rollback; socket unit + tokens/network/scenes | payload/timers/seq/order неизменны; canonical import наблюдает тот же сокет |
| 04a | выделить app/session из App, оставив прежние эффекты/буферизацию; не менять JSX layout | App→session, session→shared api/legacy store | module-time gm/invite, cleanup, старые replies, до-mount snapshot, dice history; auth/scenes/network/chat-dice | один socket на session, тот же порядок snapshot/events и безопасный StrictMode |
| 04b | вынести access/table composition в pages, App в app, main URL оставить | main/App, Login access page, pages→widgets/пока legacy UI | component keys, draft, login/setup/invite, GM vs active scene; auth/ui/scenes | только composition/import changes, без нового router и отмены guards |
| 05 | move SceneView/stage в scene-canvas, реализация прежних ports; внутренности engine не дробить | page, ports consumers, fixture injected stage URL/constructor path | mount/destroy, canvas, preview/fog/anchor; tokens/scenes/ui и startup diagnostics | один живой canvas, прежние renderer callbacks, нет import widget→widget ради Stage type |
| 06a | chat/dice и header/sidebar composition; не все панели за раз | App/pages/Sidebar/Chat, dice unit path | draft/scroll, hidden rolls, seenRolls/history, bounded animation; chat-dice/ui | неизменные server results и privacy, Chat не размонтируется |
| 06b | scene-management, player-management, scene-tools — отдельный PR на slice | Sidebar/page, MapSettings внутри slice, ports и shared leaves | scene active/current, previews private, invite pending, fog undo ownership; scenes/auth/ui/tokens | не меняются roles/права/payload/localStorage keys |
| 06c | character list, token inspector, combat tracker — отдельный PR на slice | Sidebar/page/SheetRow, extracted HpControls и stage ports | owner/null/mob, token link applied-state, delete, d20 initiative; sheets/tokens + server handlers | все исходные assertions и права, без sibling-widget imports |
| 07a | pure sheet definitions/bonus/tokenStats в выбранный DND prefix, legacy schema пока как есть | registry consumers, bonus/mob/spellbook unit paths | пути JSON, formulas, bool/0/1/2 proficiency, HP current vs template; unit/sheets/tokens | код вычислений и значения неизменны, D2 уже выбран |
| 07b | sheetOps/richDoc/RichText/DocEditor physical move | Cards/SpellBook/renderer, lazy import, richdoc unit | единый Context, XSS whitelist, resource nodes и TipTap chunk; richdoc/server richtext + sheets | renderer безопасен, editor по-прежнему lazy |
| 07c | Cards/SpellBook move внутри sheet slice | CharacterSheet, helper/context imports | search/edit, native focus, spell counters/equipment/doc; sheets + spellbook/mob/bonus unit | прежние данные, UI и server list/counter, Book System не начат |
| 07d | CharacterSheet physical move в widget legacy; дальнейшее извлечение функций отдельными PR | page и canonical sheet helpers; не TokenCard→widget | 6 widths, tabs/view/edit, drafts/overlay/autoscroll; sheets/tokens | поведение и DOM assertions прежние; длина файла сама по себе не блокер |
| 08 | отдельная серия Zustand PR, см. ниже | только согласованные consumers/connectors и test store URL | session resets, identity, subscriptions, pending; новые targeted state tests + весь CI | один store, нет lower→app imports, нет rule math в actions |
| 09 | resolver/projections и system UI seams, по одному consumer: token stats, inspector health, initiative, sheet definition | registry runtime только composition root; consumers получают props/slots | DND result parity, secret sheet absence, legacy mob, unknown key; unit/sheets/tokens/server contracts | generic consumers не импортируют конкретный registry; 5e работает полностью |
| 10, необязательный | внутренние engine modules/CSS/typed commands по отдельным измеренным задачам | только внутри slice или конкретный command family | high-frequency render, cascade, Any payload migration; профильные suites + Full CI | это не условие базовой FSD-миграции и не повод расширять scope |

PR-02 извлекает HpControls раньше перемещения sheet, чтобы удалить подтверждённую
runtime связь TokenCard→CharacterSheet. Его окончательное место/UI slot зависит от
system boundary: не превращать D&D controls в shared из удобства. Во время PR-06
допустим точный legacy import этого leaf; PR-09 закрывает исключение.
PR-07a не обещает немедленную независимость registry: PR-09 убирает временные direct
imports. Нарушения перечисляются, а не скрываются за public barrel.

PR-01 разрешается разделять на независимые небольшие PR, если это снижает риск
и облегчает ревью. Например: wire DTO, frontend types и renderer ports могут
рассматриваться отдельно при соблюдении их зависимостей. Каждый под-PR должен
собираться самостоятельно, сохранять API и поведение, иметь свои проверки и
успешный CI; разделение не означает разрешения на Stage 2.

### Когда безопасно заниматься Zustand

Не первым PR и не одновременно с перемещением App/renderer или rules extraction.
После PR-04/05 и canonical imports можно отдельно фиксировать наблюдаемые контракты:
setMe/logout/identity change, campaign GM/player clearing, character deletion/open
sheet, selected/event/snapshot, chat cap=200, flash timers, dice preference.
Сейчас полноценного unit-покрытия этих transitions store нет; его нужно добавить
**до** изменения state topology, не выдавать существующий socket unit за store tests.

1. **08a:** описать State/Actions и чистые selectors, выделить нынешние setter transitions
   с сохранением useUi API, initial defaults и одного create. Фабрика actions получает
   set/get; она не импортирует useUi из store, который сам импортирует actions.
   Чистые selectors получают state параметром, не скрытый singleton. Не вводить Redux Toolkit
   ради слова «actions»; dependencies остаются прежними. Business rules bonus/hp/dice
   не становятся store actions, transport lifecycle остаётся app/session.
2. **08b:** способ подключения consumers выбирается отдельным миграционным PR.
   App connectors и view props/callbacks — вариант, а не обязательная схема для
   каждого компонента. Не протягивать state/actions через длинные цепочки
   промежуточных компонентов только ради чистоты папок. Использовать узкие
   selectors и существующие подходящие context boundaries; локальные drafts остаются внутри прежних компонентов. По одному
   consumer family на PR, без массового prop rewiring всего UI. Pure selectors
   сущности принимают её собственный state shape, не импортируют RootState из app.
3. **08c:** когда lower consumers перестали импортировать legacy useUi, перенести
   composition в app/model и обновить test-only store URL. Удалить старый bridge;
   проверить единственность instance. Widget/feature не импортирует app connector:
   connector в app импортирует widget и передаёт результат сверху через page.

Если такой объём подключения не оправдан, допустимо отложить 08b/c и оставить legacy
store с контролируемым временным исключением по D1/D5 и явным условием удаления. Это лучше фиктивной FSD-чистоты. Отдельные
stores по каждой entity — иной архитектурный выбор, не рекомендуемый default этой
миграции. Высокочастотные Pixi coordinates/previews не переносятся в Zustand ни в
одном варианте.

## 6. Согласованные ADR D1–D7

**Статус всех семи ADR: согласовано пользователем 03.11.2026.** Они задают
направление, но не утверждают детали каждого будущего PR и не разрешают Stage 2.
Варианты из аудита сохранены как контекст выбора, не как открытое голосование.
Изменение принятого направления требует нового согласования.

| ADR | Принятое решение | Обязательные ограничения | Контекст альтернатив и последствия | Этап применения |
| --- | --- | --- | --- | --- |
| D1 | Упрощённый FSD: контроль направлений зависимостей и временный legacy allowlist | Исключения перечисляются, новые зависимости от legacy контролируются, условия удаления явные; без искусственных слоёв | Строгий textbook FSD потребовал бы больше DI и декомпозиции сразу. Выбранный подход уменьшает объём изменений, но требует сопровождения allowlist | 01 и все последующие |
| D2 | systems/dnd5e — будущая граница НРИ; registry статический в app | Без plugin SDK и немедленного переноса; wire system=mob, JSON и сохранения остаются прежними | entities/character/legacy-dnd5e рассмотрен, но не выбран. Отдельная граница яснее изолирует НРИ, добавляя нестандартный для FSD каталог | Поздние небольшие PR, начиная с согласованного scope 07a/09 |
| D3 | Точные wire DTO в shared/api; минимальные entity projections | Сохранить payload/seq/сериализацию; не дублировать все DTO ради entities | Полный DTO↔entity mapping дал бы большую независимость ценой лишних адаптеров. Выбраны только проекции с реальными потребителями | 01 |
| D4 | Сохранить императивный SceneStage и callbacks | Порты только для реальных потребителей; сохраняются lifecycle, PixiJS/React bridge, optimistic rollback и порядок событий | Раннее дробление engine или перенос всего класса в shared повышает риск. Фасад сохраняет стабильность; внутренний размер класса не исправляется одним move | 01/05 |
| D5 | Один Zustand store; отдельная миграция после App/scene | Без преждевременного дробления и чрезмерного prop drilling; actions/selectors без игровых правил; детали подключения проверяются отдельно | Множество stores усложнило бы согласованность/reset. Централизованный вариант сохраняет единый lifecycle, но требует аккуратного уменьшения связанности | 08, после 04/05 |
| D6 | Сохранить текущие правила D&D 5e; обобщать только реально необходимые интерфейсы | Без попутной смены measurement/combat/HP semantics, DB или протокола; универсальность не означает преждевременный SDK | Полное обобщение заранее расширило бы scope и потребовало backend-решений. Выбран постепенный путь с 5e как эталоном | 09 |
| D7 | Относительные импорты и узкие public API | Aliases не обязательны; временные re-export однонаправленные и с условием удаления | Aliases сократили бы пути, но потребовали согласовать TS/Vite/Node/browser resolution. Выбрана совместимость с текущими инструментами | 01/03 и далее |

Уточнение к PR-01 также согласовано: он может быть разделён на независимые
небольшие PR ради уменьшения риска и упрощения проверки. Это не разрешение
переносить модули до завершения документационного Stage 1.

## 7. Критерии завершения и следующая граница

Stage 1 завершён, когда AS-IS подтверждён кодом/графом, потенциальные риски отделены
от дефектов, текущие пути проверены, D1–D7 зафиксированы как согласованные ADR и
есть проверяемая очередность. Документация должна пройти обязательный CI на актуальном
merge SHA и быть объединена в master с отдельного разрешения. До этого Stage 2
не начинается; после объединения для него также нужно отдельное задание.

Каждый migration PR завершён, когда его цель ограничена, paths/tests обновлены,
нет новых import cycles/необъявленных upward edges, DOM/права/commands/data сохраняются,
Full CI успешен именно для текущего merge SHA, нет skipped/cancelled и артефакты свежие.
Падение сначала диагностируется; ожидания HTTP/WS/Pixi/React не заменяются sleep
или ослаблением gate. [Пример правильного барьера](E2E_TOKEN_LINK_SYNC.md).

Базовая FSD-миграция может завершиться с прежним внутренним sheet renderer и stage,
если ownership/public boundaries и оставшиеся legacy исключения честно описаны и
согласованы. Удаление исключений store/registry — отдельные явные milestones, а не
непроверяемое заявление «всё стало FSD». Конечная цель не допускает lower→app imports,
sibling-widget dependencies или универсального UI, импортирующего D&D напрямую.

Готовность **к разработке второй системы**, сверх перемещений: registry/definitions
без утечек 5e в generic consumers, отдельный legacy mob mapping, тестируемые policy
projections, согласованные backend capabilities для создания/roll/HP и безопасный
fallback. Это потребует отдельного решения по backend/сохранениям; текущий Stage
не меняет их и не гарантирует поддержку произвольной НРИ.
