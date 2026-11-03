# Очистка отдельного PixiJS renderer

## Причина

В установленном PixiJS 8.22.0 `Application.destroy(true, { children: true })`
передаёт `true` в `AbstractRenderer.destroy()`. Помимо очистки этого renderer,
это вызывает `GlobalResourceRegistry.release()`. В частности, очищаются общие
пулы Batch и BigPool. Пул Batch сохраняет ссылки на выданные элементы в массиве;
поэтому глобальный release может обнулить ресурсы уже работающего renderer.
Это опасно при отменённом асинхронном mount: B заканчивает init после того,
как новая A уже начала рисовать.

После механического переноса FSD-05 SceneStage находится в
[widgets/scene-canvas/lib/stage.ts](../web/src/widgets/scene-canvas/lib/stage.ts);
результаты ниже относятся к hotfix до переноса, его логика сохранена.
Оба вызова SceneStage используют официальный renderer destroy option
`{ removeView: true, releaseGlobalResources: false }`, сохраняя
`{ children: true }`. Pixi Application по-прежнему уничтожает ticker, children
и renderer. GlContextSystem снимает обработчики WebGL и вызывает loseContext.
Существующая очистка SceneStage listeners и ResizeObserver сохранена.
Порядок mount/destroy, cancellation, Assets и загрузка текстур не изменены.
Глобальные пулы остаются доступны другим renderer; внутренние API очистки
не вызываются. Зависимости не обновлялись.

## Регрессия

B01/B02 в `web/tests/browser/scenes.test.mjs` удерживает mount B, возвращается
в A, рисует и перестраивает реальные fog Graphics, затем отпускает B.
Проверяются локальная очистка старой A и отменённой B, единственный живой
canvas, отсутствие старых listeners и дальнейшая отрисовка после token.move.
Проверки исходных snapshot/fog/visibility сохранены.

До исправления этот контроль завершился ошибкой `BatcherPipe.execute:
Cannot read properties of null (reading 'geometry')`, неподвижным изображением
и красным after-hook `browser page errors`. В предыдущем воспроизведении того
же дефекта падал GlGraphicsAdaptor с `reading 'count'`. После исправления
контроль проходит, включая after-hook. Ошибки страницы не фильтруются.

Наблюдение использует существующий тестовый wrapper mount и нативный Chromium
CDP `getEventListeners`; EventTarget и внутренние пулы Pixi не подменяются.
Тест touch preview дополнительно проверяет удаление прежнего canvas и previews.

## Повторные переключения и ограничения

Отдельный ручной probe не меняет обязательный CI manifest из 35 тестов:

```bash
cd web
CHROMIUM_PATH=/usr/bin/chromium node --test tests/browser/pixi-cleanup-resources.mjs
```

Probe выполняет 30 переключений одинаковых сцен (6 прогревочных), проверяет
старые canvas/children/ticker/renderer/ResizeObserver/listeners и единственный
текущий stage/canvas/socket. После удаления только диагностических ссылок
собирает Chrome CDP heap и DOM counters после GC; сохраняет `resources.json`.
Это конечный эксперимент, а не доказательство отсутствия любых утечек.
GPU memory непосредственно не измеряется; освобождение локального контекста
подтверждено официальной реализацией GlContextSystem.

### Фактическое измерение на Chromium

Расширенный локальный контроль на 120 переключениях (с heap snapshots на 30-м
и 120-м) показал:

| Метрика | 30 | 120 |
| --- | ---: | ---: |
| SceneStage / Application / WebGLRenderer | 1 / 1 / 1 | 1 / 1 / 1 |
| Batch / BatchableGraphics | 3 / 107 | 3 / 107 |
| Texture / GlProgram | 5 / 5 | 5 / 5 |
| Window listeners / все DOM listeners | 20 / 208 | 20 / 208 |
| DOM nodes (между screenshot) | 166 | 166 |
| JS heap после GC, байт | 10 534 692 | 12 176 584 |

Это **не подтверждает стабильный общий heap**. В установленной реализации
`setProgramName` добавляет возрастающий суффикс имени shader при каждом создании;
`GlProgram` передаёт полученные исходники в `createIdFromString`. Его модульный
`idHash` удерживает строки, не имеет eviction и не зарегистрирован в
GlobalResourceRegistry. В heap snapshots видны дополнительные строки с именами
`graphics-vertex-N`. Другой источник роста — TextStyle/CanvasTextMetrics
(36 → 126 и 31 → 121 объектов соответственно); этот кэш ограничен LRU на 1000
записей. Также растёт JIT-код и браузерная performance timeline.

Следовательно, локальные ресурсы renderer и сохранённые пулы в этом опыте
не накапливаются, но общий рост памяти нельзя назвать устранённым. Hotfix
исправляет повреждение работающей сцены; полное завершение проверки ресурсов
требует отдельного решения по кэшу shader, без обращения к внутренним API,
monkey patches или несогласованного изменения зависимостей.

Контроль на неизменённом master `7682491ec32dff0e1bf63f6bc15b62b57167ae2b`
с исходным `destroy(true, ...)` выполнен в отдельной временной копии: 60
переключений, без сценария позднего mount. Между 30-м и 60-м переключениями
heap вырос с 10 524 336 до 11 122 528 байт; число удерживаемых строк
`graphics-vertex` выросло с 32 до 62 (170 176 → 334 816 байт). С hotfix на
этих же точках heap составил 10 534 692 и 11 144 320 байт, строки — те же
32 и 62. Таким образом, рост этого кэша существует и до hotfix и не вызван
сохранением глобальных пулов. Он остаётся отдельным ограничением готовности;
решение о его выделении из текущего исправления требует согласования.

## Локальные проверки hotfix

TypeScript, frontend unit 54/54, production build, backend 169/169 и полный
browser regression 35/35 прошли. Skipped/cancelled и ошибки after-hook отсутствуют.
Статический граф импортов не содержит циклов; production diff ограничен
двумя аргументами destroy. Предупреждение Vite о chunk > 500 kB сохраняется.
Во время hotfix FSD-05 был приостановлен; SceneStage/SceneView ещё не перемещались.


## Контроль после механического переноса FSD-05

Повторный ручной probe на 30 переключениях после переноса файлов в scene-canvas:
один текущий stage/canvas/socket, 20 window listeners и 208 DOM listeners,
DOM nodes 166 (169 во время screenshot). Локальная очистка старых сцен и after-hook
успешны. Heap после GC на 30-м переключении — 10 529 080 байт; в контрольном
hotfix-прогоне — 10 532 432 байт. Нового ухудшения в этом конечном опыте не выявлено;
уже задокументированный рост shader cache сохраняется и отслеживается отдельно
в [Issue #16](https://github.com/LunierVeil/Laterna-VTT/issues/16).
