# FSD-08b: lifecycle и reset клиентского состояния

<!-- DOCS-00 STATUS BEGIN -->
**AS-IS, DOCS-00 · 04.11.2026:** frontend FSD завершён до FSD-09b,
[PR #25](https://github.com/LunierVeil/Laterna-VTT/pull/25) объединён в master
`ff9681769978e295a763bcdea8aba536b7967566`;
[Full CI master](https://github.com/LunierVeil/Laterna-VTT/actions/runs/41884690439)
успешен (38 Chromium cases). Один Zustand-store, state/public/bridge и system UI
bindings реализованы. Модульный монолит backend/DataHome/Alembic и функции расширенной Beta
ещё предстоит внедрять; см. [реестр решений](BETA_DECISIONS.md).

Ниже сохранены исторические базы, метрики и контекст отдельных PR. «Текущий PR»,
«не начат» и «merge требует разрешения» внутри прежних этапов относятся к моменту
их записи, не к состоянию master сейчас. Исходные свидетельства не переписаны.
<!-- DOCS-00 STATUS END -->

Согласованный scope: один плоский store, четыре области из
[ADR D5-v2](ADR_STATE_BOUNDARY.md). База — FSD-08a, master
`73f7b9769d88bfd6c192c24acac14be274dec698`; PR #22 объединён с пятью
коммитами, [Full CI master](https://github.com/LunierVeil/Laterna-VTT/actions/runs/41800244382)
успешен. 08a завершён. Контракт 08b реализован в отдельной рабочей ветке;
merge 08b требует отдельного разрешения владельца. FSD-09 не начинается.

## Reset-матрица

| Причина | Очистить | Сохранить |
| --- | --- | --- |
| Logout / другая identity | me/роль, campaign и scene проекции, приватные invites/lastInvite, characters, открытый лист, chat/combat, presence, временный UI | preference diceAnimation, расположение панелей и device localStorage |
| Та же identity в свежем snapshot | Обновить разрешённые серверные проекции | локальный контекст и настройки |
| Смена сцены | selected, счётчики, chaining, combat старой сцены, scene metadata/presence, connected до snapshot | characters, открытый лист/черновики, campaign context, chat, настройки |
| Disconnect / retry | connected=false; существующий renderer очищает drag previews | identity, кэши, листы/черновики, настройки; полный reset запрещён |
| Свежий snapshot после reconnect | Обновить scene/combat/chat, connected=true | локальные черновики; история не является источником анимации |
| Последовательные одинаковые toast | Истёкший callback не очищает более новое сообщение | прежние длительности: error 2500 ms, notice 8000 ms |

Смена identity означает смену id либо серверной роли. Это защитная граница,
не новая функция live role-switch. Logout → login тем же id также новая сессия.
Будущий campaign switch потребует такой же invalidation загрузок и очистки
campaign-bound данных, но переключателя и нового API здесь нет.

## Сохраняемые контракты

- `setMessages` принимает полную серверную историю без дополнительного ограничения.
  `pushMessage` сохраняет последние 200 событий без новой дедупликации. Это разные
  существующие контракты; 08b не меняет пользовательскую семантику истории.
- Seq, cmd_id, base_seq, доставка и восстановление SceneSocket не меняются.
  App подписывается на существующий onDisconnect.
- PixiJS runtime и transient drag data остаются вне store.
- HTTP guards и socket callbacks должны отвергать прежнюю сессию даже до React cleanup.
- UI читает `state/public`; серверные projections/lifecycle проходят через
  ограниченный app/session bridge. Никаких прямых UI setState.

## Проверки

Первый коммит закрепляет сохранённые transitions и transport-инварианты. Далее
регрессионные тесты проверяют атомарный identity reset, late HTTP, scene/reconnect,
отсутствие повторной анимации истории и toast generations. Ни skipped/todo, ни
произвольные sleep не используются. Каждый коммит проверяется Fast CI; готовый PR —
Full CI с sheets 8/8, tokens 8/8, scenes 5/5, interaction 14/14 и строгим CI required.

Backend, payload, БД, игровые правила, CSS, ROADMAP и Beta UX не входят в scope.

## Реализация и изменение поведения

1. `setMe` при logout либо смене id/серверной роли атомарно очищает все
   пользовательские/campaign/scene данные и transient UI. Для той же identity
   повторный snapshot не вызывает reset. Общие defaults создают новые контейнеры;
   actions сохраняют identity. DiceAnimation не пересчитывается и не перезаписывается
   при reset; ключ `lanterna.diceAnimation`, чтение preference и hardware fallback прежние.
2. Плоское поле `sessionEpoch` — локальная generation, не wire DTO. Оно меняется
   на identity boundaries, в том числе logout → login тем же id. Bridge выдаёт lease
   `captureSession`, не новый setter. UI не может изменять epoch или серверные проекции.
3. `loadCampaignData` использует AbortController и lease до применения обоих HTTP
   ответов. Cleanup отменяет запросы; epoch защищает и до cleanup/при игнорировании abort.
   Route помечен epoch, поэтому старая сцена не открывается для новой identity.
   Bootstrap `/api/me` и GM login также проверяют lease перед применением ответа.
4. `beginScene` сбрасывает только selected/counts/chaining, старый combat,
   scene metadata/presence, connected и zoom. Это новый scene connection;
   retry того же SceneSocket не вызывает beginScene. Персонажи, открытый лист и
   выбранные инструменты сохраняются. Бой новой сцены приходит из snapshot.
5. App/session подписан на существующий onDisconnect; connected остаётся false
   во время retry и WebSocket open, true — после принятого snapshot. Старый socket,
   buffer или cleanup не пишет поверх нового владельца. Transport/seq-код не менялся.
6. История snapshot только отмечает roll ids как увиденные. Reconnect не закрывает
   лист, не очищает drafts и не повторяет анимацию истории. App animation помечена
   epoch; buffered Pixi snapshot/events принадлежат конкретному socket и очищаются
   при cleanup. Сам Pixi renderer/lifecycle не изменён.
7. Error/notice generations живут в замыкании конкретной UI factory, не в wire state.
   Старый таймер сверяет generation и epoch. Повтор одинакового текста получает
   полный новый срок; manual setError/dismissNotice инвалидируют прежние callbacks.

Сохранение раскрытия боковой панели/инструментов подтверждается неизменённым
Chromium auth assertion. Первая попытка сбрасывала эти device preferences;
регрессия выявлена локально и исправлена до второго коммита.

## Проверка границ и исключения

Сохраняются три bridge consumers: access, useCampaignScene, useSceneConnection.
Public добавил только read-only sessionEpoch/selector; arbitrary projection writers
по-прежнему недоступны UI. Существующие три whole-store subscriptions сохранены.
Новые unit/integration tests используют canonical store или изолированные factory
instances только для диагностики. SceneSocket интеграционно проверяется с управляемым
WebSocket и fake timers, без изменения production transport или browser fixtures.

Полная история не нормализована и не дедуплицируется: существующий тест сохраняет
250 записей setMessages, затем проверяет предел 200 и повтор id при pushMessage.
Политика принята как AS-IS; сервер остаётся источником истории и прав.

## Оставшиеся ограничения

- Campaign switch пока не реализован. Будущий переключатель обязан инвалидировать
  lease и очищать campaign-bound проекции; новый endpoint/selector здесь не добавлен.
- Live role-switch не добавлен; reset на изменившуюся серверную роль — защитная
  граница, а не административная функция.
- Неуспешная первичная HTTP-загрузка сохраняет прежнее error/log поведение экрана
  загрузки; retry UI не вводился. Guards защищают принадлежность ответа сессии,
  а не решают произвольный порядок HTTP и WS изменений внутри одной identity.
- Известный shader cache PixiJS (Issue #16) не исправляется этим PR.
- Подробный ROADMAP v5 и Beta Dice Overlay остаются отдельными согласованными задачами.
