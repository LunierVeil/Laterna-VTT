# FSD-08b: lifecycle и reset клиентского состояния

Согласованный scope: один плоский store, четыре области из
[ADR D5-v2](ADR_STATE_BOUNDARY.md). База — FSD-08a, master
`73f7b9769d88bfd6c192c24acac14be274dec698`; PR #22 объединён с пятью
коммитами, [Full CI master](https://github.com/LunierVeil/Laterna-VTT/actions/runs/41800244382)
успешен. 08a завершён. Этот документ описывает целевой контракт 08b;
первый коммит фиксирует сохранённые инварианты, исправления идут следующими коммитами.

## Reset-матрица

| Причина | Очистить | Сохранить |
| --- | --- | --- |
| Logout / другая identity | me/роль, campaign и scene проекции, приватные invites/lastInvite, characters, открытый лист, chat/combat, presence, временный UI | preference diceAnimation и device localStorage |
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
