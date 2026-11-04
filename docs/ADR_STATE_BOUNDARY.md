# ADR D5-v2 и уточнение D1: централизованное состояние frontend

Статус: **согласовано владельцем для FSD-08a**. База — master
`922a58c6463e8582a125558e9ad30f9113fa7840`, после FSD-07/PR #21.
Исторические [D1/D5 и план 08c](FSD_MIGRATION_PLAN.md#6-согласованные-adr-d1d7)
сохраняются как история; это новое уточнение, не ретроспективная правка таблицы ADR.

## Решение

Один production Zustand store с плоской формой состояния. Логические области:

| Область | Поля |
| --- | --- |
| Session | me, isGm, connected |
| Campaign | accounts, invites, lastInvite, activeSceneId, scenes, folders, users |
| Gameplay | characters, combat, messages, sceneName, gridSize, background |
| UI | openCharacterId, combatOpen, placeHidden, fogMode, wallKind, hiddenRolls, sideTab, zoom, tool, error, notice, chaining, selected, selectionCount, selectionEditable, diceOpen, diceAnimation |

Области не равны reset scopes: characters/messages принадлежат кампании, combat —
сцене, а открытый лист сохраняется при смене сцены. В 08a reset не расширяется.

`state/public` — согласованная инфраструктурная граница упрощённого FSD. UI получает
данные через совместимый hook/selectors и ограниченные UI actions; произвольный
setState не экспортируется. `state/bridge` разрешён только app/session для записи
серверных проекций. Auth composition App делегирует такую запись app/session.
UI logout остаётся отдельным намерением после прежнего HTTP logout, не API записи
произвольной identity. Очистка старого lastInvite перед новым запросом также остаётся
узким UI intent: clearLastInvite не принимает новый код от UI. SceneView пишет существующие UI-проекции именованными actions.

Направления: app/pages/widgets/features → state/public; app/session → state/bridge;
state → entities/shared. Entities/shared/systems не импортируют state. State не
импортирует app/pages/widgets/features или systems/dnd5e. Публичные типы не создают
циклов. Factories получают set/get и не импортируют canonical singleton.

Прежний `state/store.ts` сохраняет единственный canonical instance и диагностический
URL для существующих E2E getState/subscribe. Raw доступ — внутренности state и
test instrumentation, не разрешение production consumers обходить public/bridge.
Ни barrel, реэкспортирующий app store, ни второй store не вводятся.

## Отличие от исторического направления

Сохраняются один store, отсутствие игровых правил в actions, осторожность с
prop drilling и отдельный этап после App/scene. Обязательный перенос composition
в app/model из исходного плана 08c заменён явной state boundary. Уточнение D1
разрешает эту инфраструктурную границу вместо неявного вечного legacy-исключения.

Не создаются четыре stores, Redux, новые providers, SDK/DI, универсальный game engine.
Полные tokens/walls/fog, per-frame координаты, drag-preview, refs и Pixi lifecycle
остаются у существующих владельцев. API/WS/DB, seq/cmd_id/base_seq и permissions прежние.

## Строгая совместимость 08a

Сохраняются defaults, localStorage keys, моменты чтения/записи preference, таймеры
2500/8000 мс, identity transitions, partial merges и порядок notifications.
Сохраняются также существующие подписки: Chat/TopBar/DiceMenu пока читают весь store.
Чистые selectors добавляются без автоматического сужения этих трёх subscriptions.

Characterization tests описывают AS-IS, включая известные ограничения: setMe не
делает полного reset, player campaign сохраняет invites/lastInvite при отсутствии
scenes, история setMessages не ограничивается push-лимитом, same-text timer может
очистить новое уведомление. Это не утверждение желаемого поведения навсегда.

08b **не разрешён**. Отдельного согласования требуют reset matrix, stale HTTP guards,
logout/role/scene/reconnect/campaign policies, atomic snapshot/reset, изменение
connected, исправление таймеров и расширение persistence. UI/CSS, листы, Dice Overlay
и ROADMAP/Beta-функции не меняются. Merge требует отдельного разрешения.

## Реализация и проверяемые ограничения 08a

Raw production imports теперь разрешены только внутри state. Bridge allowlist —
app/session/access.ts, useCampaignScene.ts, useSceneConnection.ts. Публичный data-only
hook сохраняет field references и отдельные subscriptions; snapshots кешируются по
root identity. Whole-store consumers продолжают наблюдать каждый root update.
setSelectionCounts/dismissNotice воспроизводят прежние partial writes без batching.
Diagnostics продолжают использовать тот же canonical store URL и subscribe; тестовые
factory instances изолированы и не являются дополнительными production stores.

Characterization, factory, public, bridge и AST architecture tests проверяют совместимость.
Исправление сохранённых ограничений не входит в 08a и потребует явного изменения
контракта в отдельно согласованном 08b. Новые тесты не ослабляют существующие 35
Chromium scenarios, их assertions, timeouts, manifest или CI required.
