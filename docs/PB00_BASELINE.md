# PB-00 — Alpha baseline и тестовая основа LOS

Локальная подготовка от master `7e5b84916b8ed1fdcdcd225ff62ac5a0991a9c79`
(DOCS-00, PR #26). Ветка `test/pb-00-los-baseline`. Это тесты и измерения
существующей Alpha, **не реализация PB-01/PB-02 и не готовый свет**.
Локальная подготовка завершена; результаты и ограничения приведены ниже.

## AS-IS: переиспользованная инфраструктура

| Область | Канонический механизм | Что делает PB-00 |
| --- | --- | --- |
| Backend | [conftest.py](../server/tests/conftest.py), [test_handlers.py](../server/tests/test_handlers.py) | Повторно использует один TestClient/event loop, GM/player fixtures и WS helpers. DB/uploads/key задаются до импорта app |
| Browser | [fixture.mjs](../web/tests/browser/fixture.mjs) | Тот же временный SQLite, отдельные порты/API/Vite, синтетические accounts, contexts ГМ/игрока, capture, until, pageFor и реальный SceneStage |
| Регрессии | [run.mjs](../web/tests/browser/run.mjs), [CI gate](../scripts/ci_gate.py) | Без изменений: 13 suites, 38 cases; groups sheets 9 / tokens 8 / scenes 5 / interaction 16 |
| Сеть | [SceneSocket](../web/src/shared/api/scene-socket.ts), [main.py](../server/app/main.py) | Проверяет настоящий snapshot/event/noop/cmd_id и reconnect; не меняет seq или retry timers |
| Pixi cleanup | [resource probe](../web/tests/browser/pixi-cleanup-resources.mjs), [исторические измерения](PIXI_STAGE_CLEANUP.md) | Использует существующее наблюдение mount и нативный CDP listener inspection, не дублирует stress harness |

Новый [backend module](../server/tests/test_pb00_baseline.py) автоматически
подхватывается обычным pytest. [PB-00 Chromium probe](../web/tests/browser/pb00-baseline.mjs)
запускается явно, как существующий resource probe; он **пока не включён** в strict
browser manifest. Будущее включение новых cases в CI потребует согласованного
обновления manifest/counts/gate; существующие проверки не заменяются этим probe.

## Синтетические сцены

Единственный [генератор](../server/tests/fixtures/los_baseline.py) не импортирует
app, PixiJS или игровые правила. Он создаёт свежие структуры без random/time и
не читает пользовательские файлы. Координаты — пиксели сцены, grid 70 px,
размер 2100 × 1400. IDs при установке — UUID5 от изолированного scene ID/индекса;
семантические данные воспроизводимы, UUID реальных тестовых аккаунтов — нет.

| Ключ | Данные | Назначение и граница |
| --- | --- | --- |
| empty | Пустая сцена с квадратной сеткой | Начальная загрузка и контроль после unmount |
| straight | Два токена по разные стороны прямой стены | Существующая блокировка движения; наличие стены не означает LOS |
| corner | Два соединённых сегмента | Геометрический input для будущих угловых LOS-тестов |
| door-closed | Закрытая дверь | Alpha movement blocker |
| door-open | Открытая дверь | Alpha разрешает проход |
| door-locked | Запертая дверь | Alpha блокирует проход; права переключения уже покрыты test_handlers |
| window-opening | Model-only window и разрыв между сегментами | Поля поддержаны ORM, но window не принимает wall.add. blocks_sight=false здесь — конкретный input, не утверждённая оптика окон |
| gm-layer | Публичный и GM-layer токены | Snapshot/REST filtering и отсутствие скрытого payload |
| manual-fog | Чужой и свой токены под fog, GM-layer токен, полностью закрытый fog сегмент | Исключение владельца, отсутствие секретного окклюдера, noop и reconnect |
| complex | 30 токенов, 200 сегментов, 15 emits_light > 0 | Нагрузка Alpha renderer; **15 потенциальных источников**, не 15 отрисовываемых lights |

Все десять сцен проверяются roundtrip через настоящие модели/REST; pure generator
проверяется на воспроизводимость и независимость возвращаемых объектов.
Movement characterization отдельно различает стену и три состояния двери.
Secret door не добавлялась как поддерживаемая WS-функция.

CLI без `--database` только печатает сгенерированные данные. Seed adapter нужен
потому, что Alpha-команды ещё не устанавливают emits_light/vision_range и не
принимают window. Он работает **только с test.db в существующих fixture temp dirs**,
проверяет принадлежность синтетических actors кампании и пустую сцену с seq=0,
не перезаписывает существующие объекты, вставляет данные одной транзакцией и
закрывает соединение. Нет DDL, ALTER, JSON conversion, новых endpoint/команд.
Обычные команды после seed снова проходят действующий server-authoritative путь.

## Изоляция и очистка

- Ни одна сцена/БД/media/key не копируется из Alpha-партии или пользовательского DataHome.
- Seed adapter отвергает произвольный путь и непустую сцену; это проверено тестами.
- Backend-scene fixtures удаляют только созданные ими сцены через scene.delete,
  после проверки возвращают активную исходную тестовую сцену.
  Имя player аккаунта PB-00 уникально: промежуточный полный прогон выявил
  конфликт с фиксированным именем из другого модуля; исправлена только новая
  fixture, затем повторён полный backend suite.
- Backend conftest теперь держит TemporaryDirectory вместо бесхозного mkdtemp:
  после выхода pytest-процесса удаляется только его собственный временный каталог.
  Отдельный subprocess-тест проверяет удаление synthetic DB/uploads/key.
- Browser закрывает страницы, возвращает исходную сцену и удаляет новые сцены.
  Существующий after hook закрывает contexts/browser, API/Vite и удаляет свой temp.
  Отсутствие каталога проверено после завершения probe.
- JSON/логи/screenshots находятся вне Git в BROWSER_RESULTS_DIR; пользовательские
  базы и ключи не попадают ни в fixtures, ни в diff. dev.sh reset не применялся.

## Два клиента и существующие гарантии

Backend и Chromium независимо проверяют:

1. GM/player получают snapshot одной сцены с seq=0; ГМ видит все три токена,
   игрок — только свой под manual fog. Чужой fog-hidden и GM-layer отсутствуют;
   полностью закрытая fog стена тоже не передаётся. Клиент не может считать LOS
   по такой неполной геометрии без отдельного projection-контракта.
2. GM-only update получает seq=1 и cmd_id у мастера, игрок — ровно
   `{type:event, name:noop, seq:1, payload:{}, cmd_id:null}` без скрытого ID/имени.
3. Разрешённый player token.move даёт seq=2 с тем же cmd_id на обоих клиентах;
   Chromium ждёт и событие, и применение координат в обоих SceneStages.
4. Игрок отключается; ГМ двигает его токен, seq=3. После reconnect игрок получает
   новый snapshot seq=3 с текущими координатами, скрытых токенов в нём нет.
5. Chromium использует реальный app SceneSocket и его retry, проверяет connected
   false/true и один живой app socket. Offline ставится только context игрока,
   мастер остаётся online. Искусственных sleep и подмены таймеров нет.

Это **не exactly-once исполнение cmd_id**, не durable outbox и не новая replay
семантика. Дубликаты/пропуски seq и rollback уже покрыты [socket unit](../web/tests/socket.test.ts);
родственные lifecycle cases — [scenes](../web/tests/browser/scenes.test.mjs)
и [network](../web/tests/browser/network.test.mjs). Они сохранены.

## AS-IS и GAP для PB-02

| Проверка | AS-IS | Что ещё GAP |
| --- | --- | --- |
| GM-layer / manual fog | Сервер фильтрует snapshot/REST/events; noop сохраняет seq; свой token виден под fog | Нет current LOS или explored policy |
| Прямая стена / дверь | Сервер проверяет движение | Стена пока не скрывает токен за ней по LOS |
| Секретное изображение | URL отсутствует вместе с отфильтрованным токеном | Скопированный /uploads URL доступен анонимно |
| Окна / секретные окклюдеры | Есть некоторые поля в модели | Нет согласованной безопасной projection и полной командной поддержки |

`test_gap_private_image_url_is_currently_public` загружает только синтетический
PNG, связывает его с GM-layer токеном и воспроизводит anonymous GET = 200 с теми
же байтами. Это намеренный **characterization существующего GAP**, а не будущая
security acceptance. При PB-02 данный тест надо заменить проверкой отказа/прав,
а не сохранять публичный доступ ради зелёного baseline. Маршрут в PB-00 не менялся.
Обычная публичная подложка может передаваться целиком — это отдельная семантика.

## Измерение renderer

Три локальных запуска probe выполнены без параллельного pytest/build/browser
workload. Vite development, headless Chromium 154.0.8037.57, PixiJS 8.22.0;
Linux 6.18.57 x86_64, AMD EPYC 9V74, 5 видимых logical CPU, cgroup CPU quota
400000/100000 (4 CPU), memory limit 32 GiB. Это shared cloud, не выделенная
игровая машина. Node 24.19.0, Python 3.12.14.

Renderer: ANGLE Vulkan **SwiftShader (software)**. Один GM canvas, viewport
1280 × 900, DPR 1; canvas 876 × 842. Сцена 2100 × 1400, начальная камера;
все 30/200 объектов загружены, но вся карта не помещается в viewport одновременно.
Нет картинок/текстур карты, FoW или настоящих lighting passes в complex profile.

| Измерено | Запуск 1 | Запуск 2 | Финальный запуск |
| --- | ---: | ---: | ---: |
| Seed process + SQLite transaction, мс | 61,99 | 35,64 | 49,53 |
| Новая страница → canvas/connected/полные 30 tokens + 200 walls, мс | 1147,72 | 1129,85 | 1174,05 |
| rAF interval, median / p95 / max, мс | 83,3 / 100 / 150 | 83,3 / 100 / 116,7 | 83,4 / 100,1 / 116,7 |
| Дополнительный app.render CPU call, mean / p95, мс | 0,048 / 0,2 | 0,048 / 0,1 | 0,050 / 0,2 |

Финальный запуск включает дополнительную проверку скрытого окклюдера и явное
закрытие seed SQLite connection; все три запуска завершились 2/2 PASS.

После 30 прогревочных кадров записаны 120 rAF-интервалов и 120 длительностей
дополнительного app.render вызова. Это наблюдение cadence в данной среде,
**не фактический presented FPS**, не полная длительность GPU frame и не SLA.
Короткие CPU calls ниже разрешения browser timer часто дают 0; GPU time/memory,
аппаратный Chromium, mobile и production renderer здесь не профилировались.
Численные gates не вводились.

В финальном запуске JS used heap после GC: перед sampling 9 381 800 B, после
переключения на пустую сцену и удаления diagnostic refs 8 885 864 B. DOM nodes
192 → 189, общие JS event listeners 199 → 202. Общий listener count включает
React/UI и не является доказательством отсутствия утечек.
Непосредственная проверка stage-specific listeners: 5 до unmount, 0 у старого
stage после. Старые canvas отключён, root уничтожен, renderer/ResizeObserver
null, ticker остановлен; текущих stage/canvas/socket по одному.

Один unmount и конечный heap sample не доказывают стабильность памяти при
долгой игре. Известный рост shader cache [Issue #16](https://github.com/LunierVeil/Laterna-VTT/issues/16)
сохраняется; исторический 30/120-switch stress не выдаётся за новый замер.

## Повторение проверок

Из корня (Linux/WSL, существующие зависимости):

```bash
server/.venv/bin/python -m pytest server/tests/test_pb00_baseline.py -q
server/.venv/bin/python -m pytest server/tests -q
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build
```

Отдельный probe и существующие регрессии из web:

```bash
CHROMIUM_PATH=/usr/bin/chromium BROWSER_RESULTS_DIR=/tmp/laterna-pb00 node --test tests/browser/pb00-baseline.mjs
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- --group scenes
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- --group tokens
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- --group interaction
```

Baseline JSON сохраняет raw samples, renderer/environment, heap/DOM counters и
cleanup; рядом startup.json/logs/screenshots существующей fixture. Измерять
отдельно от других прогонов. Повторный запуск создаёт новые DB/actors/ports;
для сравнения результатов использовать разные BROWSER_RESULTS_DIR.

## Риски и решения до соответствующего этапа

- **Перед PB-01:** согласовать numerical contract: units/grid independence,
  epsilon, касание/коллинеарность, zero-length/дубли, вершина угла, observer на
  стене и допустимые диапазоны. Alpha segments_intersect обслуживает movement;
  его epsilon/семантика не становятся автоматически оптикой LOS.
- **Перед оптической интеграцией PB-01/PB-02:** определить window/door и
  blocks_sight/emits_light compatibility. Seed-data window не утверждает правила.
- **Перед PB-02/выдачей клиенту:** согласовать public occluder projection и
  сокрытие secret geometry; разделить role access/current LOS/explored/manual fog,
  сохранить или отдельно изменить owner exception. Чистая геометрия может
  разрабатываться независимо, но не становится авторизацией сама по себе.
- **PB-02:** закрыть anonymous access к restricted media; не лечить это CSS,
  случайным URL или клиентским polygon. Сохранить seq/noop/add/remove переходы.
- **Migration gate:** новая схема/несовместимый persisted JSON требует необходимой
  части DataHome/backup/Alembic до такого изменения. PB-00 их не добавляет.
- Для будущего LOS нужны дополнительные degeneracy/security/failure tests;
  текущие 10 сцен — foundation, не исчерпывающий набор пограничных полигонов.
- Производительность SwiftShader не переносится на GPU клиента. Нужны отдельные
  production/hardware measurements; Issue #16 не исправлена.

Исторический LATERNA_SCENE_CORE_AUDIT.md от 02.11.2026 доступен в материалах
владельца. Проверены P0-01/02/03/04/06 и SC-023/027: projection, ACL/LOS/FoW,
delivery/idempotency, media и migration risks. Его старые пути и предлагаемый
полный Scene Core rewrite не становятся утверждённым scope PB-00.

Реализация геометрии PB-01 не начиналась. Этот отчёт фиксирует локальную
подготовку; статус публикации и результаты Fast CI указываются в Draft PR PB-00.

## Итог локальных проверок

| Проверка | Результат |
| --- | --- |
| Полный backend pytest после окончательных правок | **194/194 PASS**, включая **25 PB-00** |
| Frontend unit | **118/118 PASS** |
| TypeScript / production build | **PASS / PASS** |
| Существующие Chromium scenes / tokens / interaction | **5/5 / 8/8 / 16/16 PASS** |
| Новый PB-00 probe, финальная версия | **2/2 PASS**, seq 0 → 1 → 2 → snapshot 3, cleanup PASS |
| Scripts/structure | **31/31 PASS** |
| Локальные Markdown-ссылки и якоря | **258 PASS**, доступность всех внешних URL не заявляется |
| Diff-check и scope | **PASS**, только тестовая инфраструктура и этот отчёт |

Failed/skipped/cancelled в итоговых выбранных прогонах нет. Sheets отдельно в
PB-00 не запускалась: игровой UI/листы не менялись. Full CI готового PR на этом
этапе не запускался: сначала требуется независимое архитектурное review Draft PR.
Предыдущий CI master не подменяет эти проверки.
Сохраняются предупреждения Starlette/httpx и Vite chunk >500 kB; зависимости
и build settings ради их устранения здесь не менялись.

Основа готова к архитектурному review PB-01: генератор, roundtrip, два клиента,
reconnect, cleanup и измеряемый профиль воспроизводятся. Перед реализацией нужно
закрепить численный контракт LOS; перед защищённой интеграцией — решить projection/
policy/media gaps. Готовность security/light/FoW или отсутствие memory leak
не заявляются. Следующий этап автоматически не запускается.
