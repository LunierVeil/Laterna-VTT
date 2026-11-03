# Alpha token settings: синхронизация привязки токена

Контекст: merge PR #5, master `8ef65f3228372424bbf6f47c1cd185c3d843db1b`.
[Full CI 41511953207](https://github.com/LunierVeil/Laterna-VTT/actions/runs/41511953207)
завершился с ошибкой в tokens: 7/8, исходный `tokens.test.mjs:100`, combobox count
`1 !== 0` после HTTP-подтверждения привязки. До merge PR Full CI был успешен.
PR #5 не менял этот тест или цепочку привязки; оснований для rollback не выявлено.

## Цепочка обновления

1. [TokenCard](../web/src/widgets/token-inspector/ui/TokenCard.tsx): CharacterLink отправляет `token.update`
   с ID токена и character_id. Оптимистичного изменения selected здесь нет.
2. [handlers](../server/app/handlers.py): token_update проверяет права и записывает
   character_id, возвращает полный `token.updated`.
3. [main](../server/app/main.py): внутри scene lock увеличивает seq и делает
   `await db.commit()`. Затем подготавливает представление токена и выполняет
   `hub.broadcast_each`. HTTP GET сцены может увидеть commit до отправки/применения WS.
4. [SceneSocket](../web/src/shared/api/scene-socket.ts): игнорирует старый сокет и повторный seq;
   ожидает следующий seq, при разрыве переподключается за snapshot. Snapshot заменяет
   lastSeq. Подтверждённые сообщения передаются подписчикам.
5. [App](../web/src/app/App.tsx): направляет event в stage.applyEvent; snapshot в
   setSnapshot. До готовности renderer события буферизуются.
6. [SceneStage](../web/src/widgets/scene-canvas/lib/stage.ts): token.updated вызывает updateToken,
   обновляет TokenView.data; для выбранного токена повторяет setSelection/onSelect.
7. [SceneView](../web/src/widgets/scene-canvas/ui/SceneView.tsx) проецирует выбранный Token в
   [Zustand selected](../web/src/state/store.ts). TokenCard подписан на selected.
8. React удаляет CharacterLink, когда `token.character_id` становится непустым.

Ошибка теста: завершение шага 3 считалось барьером готовности шага 8.
HTTP, наблюдение сетевого пакета и commit React не являются одним событием.

## Воспроизведение и пределы вывода

Три исходных изолированных запуска Alpha и одна исходная группа tokens прошли.
Естественное локальное падение в строке 100 не воспроизведено. Исторических
снимков WS/selected/DOM того GitHub run нет, поэтому точную покадровую
последовательность его падения восстановить нельзя.

В отдельном временном Playwright harness удержан только целевой входящий
`token.updated` до HTTP-подтверждения; пакет не изменялся, задержка управлялась
release-сигналом, а не sleep. Все изменения транспорта ограничены этим harness.

| Слой | До доставки | После доставки того же пакета |
| --- | --- | --- |
| HTTP token.character_id | нужный character ID | тот же ID |
| server seq / event seq | 2 / 2 | 2 / 2 |
| SceneSocket.sequence | 1 | 2 |
| SceneStage token.character_id | null | нужный ID |
| Zustand selected.character_id | null | нужный ID |
| combobox count | 1 | 0 |

Таким образом воспроизведено неверное для исходного assert состояние (1 вместо 0)
при допустимом асинхронном порядке;
неизменённый пакет со следующим seq привёл клиент в правильное состояние, без
resync. Отдельно проверен настоящий reconnect: snapshot с правильной привязкой
также восстанавливает SceneStage/selected/DOM. Потери или ошибки применения
события в этих проверках не обнаружены; это не утверждение об отсутствии всех
возможных сетевых ошибок.

CDP `framereceived` в harness может зарегистрировать перехваченный пакет раньше
его передачи app handler. Поэтому одного `page.received` недостаточно: новый
барьер отдельно проверяет фактически применённый sequence и оба состояния клиента.

Предварительная полная копия сценария с WS proxy остановилась раньше на проверке
checkbox «Скрыт от игроков» и не дошла до исследуемого assert. Она не считалась
воспроизведением строки 100; контрольный эксперимент ограничен переходом привязки.
Первый вариант проверки harness также ошибочно ждал отсутствия CDP receipt;
его заменили проверкой отсутствия применения состояния. Приложение не менялось.
Отрицательный контроль с непереданным пакетом подтвердил: bounded state wait
отклоняется, исходные states остаются неприменёнными, JSON диагностики сохраняется.
Короткий deadline задан только во временном negative harness; таймауты реального
сценария не изменены.

## Минимальное исправление

В существующем Alpha сохраняются все исходные проверки и конечный count=0.
После HTTP тест отдельно ждёт:

- `token.updated` или snapshot именно с нужными token ID и character ID;
- применённый SceneSocket.sequence не меньше seq этого сообщения;
- нужные ID и character_id в живом SceneStage и Zustand selected;
- реальное удаление combobox из DOM.

Используются существующий bounded until и locator.waitFor. Таймаут теста 90 с,
общие таймауты, количество browser-тестов и строгий CI gate не изменены.
Новых sleep и retry всего сценария нет. Игровое приложение не меняется.

Test-only helper захватывает ссылку на существующий SceneSocket при отправке
целевой команды и сразу восстанавливает исходный send. Он не перехватывает и не
задерживает WS-сообщения, не изменяет seq, selected или renderer. При ошибке
сохраняется `alpha-token-link-failure.json` в BROWSER_RESULTS_DIR/tokens с:
HTTP token/seq, сообщениями и их seq/cmd_id, реальным applied sequence,
SceneStage, selected и combobox count. Исходное исключение пробрасывается дальше;
ошибка записи диагностики не превращает тест в успешный.

## Локальная проверка

Из web, каждый запуск получает отдельные DB/uploads/ключ, порты и процессы:

```bash
CHROMIUM_PATH=/usr/bin/chromium node --test --test-name-pattern='^Alpha token settings:' tests/browser/tokens.test.mjs
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- --group tokens
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
npm test
npm run typecheck
npm run build
```

Из корня: backend pytest и `python3 -m unittest discover -s scripts/tests -v`.
Экспериментальные harness, JSON, screenshots и логи лежат в игнорируемом
`artifacts/token-link-sync/`; они не включаются в commit. Результаты:

| Проверка | Результат |
| --- | --- |
| Исходный Alpha, свежая среда на каждый запуск | 3/3 |
| Исходная группа tokens | 8/8 |
| Исправленный Alpha, свежая среда на каждый запуск | 3/3 |
| Исправленная группа tokens | 8/8 |
| Полный Chromium | 35/35, без skipped/cancelled |
| Контроль доставки того же пакета | успешно |
| Контроль настоящего reconnect snapshot | успешно |
| Отрицательный контроль недоставленного пакета | ожидаемое отклонение; ложного успеха нет |
| Frontend unit | 40/40 |
| Backend | 169/169 |
| Служебные тесты | 30/30 |
| TypeScript / production build / diff-check / ссылки | успешно |

JUnit сверён со строгим gate: sheets 8, tokens 8, scenes 5, interaction 14.
Локальный браузер — Chromium 154, CI использует закреплённую версию Playwright.
Остались прежние неблокирующие предупреждения Starlette/httpx и размера build chunk.
 Full CI через исправляющий PR
нужно проверить после отдельно разрешённых commit/push.
