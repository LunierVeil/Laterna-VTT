# Beta 0.5 · карта готовности интерфейса

Источники функционального объёма: [ROADMAP](https://github.com/LunierVeil/Laterna-VTT/blob/7a35500e85175c0e3d4f57715f3e71ad134bedaf/docs/ROADMAP.md), [BETA_DECISIONS](https://github.com/LunierVeil/Laterna-VTT/blob/7a35500e85175c0e3d4f57715f3e71ad134bedaf/docs/BETA_DECISIONS.md), [ревью PR №104](https://github.com/LunierVeil/Laterna-VTT/pull/104#pullrequestreview-6083210121).

## Approved UI

Проверен [обновлённый рабочий файл Laterna UI Design System](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY). В нём 24 страницы, 32 локальные переменные в коллекциях Laterna Colors, Laterna · UI Layout и Laterna / Brand Radiance, 8 текстовых стилей. Локальных стилей заливки и эффектов нет. Ниже рекурсивный учёт узлов по всем страницам. Дочерние варианты входят в число компонентов.

| Сохранённая страница | Frames | Components | Component sets | Instances |
| --- | ---: | ---: | ---: | ---: |
| [Laterna UI Kit](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=0-1) | 55 | 9 | 3 | 0 |
| [Legacy References](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=6-2) | 0 | 0 | 0 | 0 |
| [UI Components v0.3 · Masters](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=28-2) | 49 | 39 | 5 | 40 |
| [UI Components v0.3 · Overview](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=34-2) | 62 | 0 | 0 | 52 |
| [UI Components v0.3 · React Spec](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=36-2) | 8 | 0 | 0 | 0 |
| [Laterna · Lantern Logo Concepts v0.1](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=64-2) | 94 | 22 | 4 | 37 |
| [Laterna · Lantern from Posters v0.3](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=78-2) | 20 | 6 | 2 | 3 |
| [Character Sheet · Current UX Audit](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=86-2) | 106 | 0 | 0 | 0 |
| [Character Sheet · Skills & Death Saves UX v0.4](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=104-2) | 405 | 5 | 1 | 77 |
| [Character Sheet · Personal Skill Order UX v0.5](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=117-266) | 609 | 0 | 0 | 72 |
| [Character Sheet · Beta UX v0.6 · Map-safe](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=135-2) | 430 | 4 | 1 | 90 |
| [DESIGN-01 · Geometry, Light & FoW · Beta UX v0.1](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=166-2) | 218 | 14 | 3 | 105 |
| [DESIGN-01 · Editor UX v0.2 · Review](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=187-2) | 353 | 2 | 1 | 169 |
| [DESIGN-01 v0.3 · UX Polish](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=207-2) | 298 | 38 | 2 | 178 |
| [DESIGN-01 v0.3 · ToolRail Icons · Review](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=218-2) | 265 | 60 | 1 | 117 |
| [LATERNA · Icon Library v1.0 · Review](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=233-2) | 735 | 102 | 1 | 284 |
| [DESIGN-ICONS-01 · UX Fixes & A2 Logo Review](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=263-2) | 671 | 0 | 0 | 436 |
| [LATERNA · Brand Identity v1.0 · Review](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=276-2) | 117 | 5 | 0 | 59 |
| [DESIGN-FIX-02 · Icons, Micro Logo & Handouts](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=300-2) | 110 | 1 | 0 | 60 |
| [DESIGN-FIX-03 · Character NPC & Beta UI · Owner Review](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=451-2) | 1101 | 0 | 0 | 467 |
| [DESIGN-FIX-04 · Character Progression & Inventory · Owner Review](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=495-2) | 325 | 0 | 0 | 0 |
| [DESIGN-FIX-05 · Lighting Presets & Character UX · Owner Review](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=501-2) | 349 | 0 | 0 | 4 |
| [DESIGN-SHEET-VARIANTS-01 · Owner Review](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=514-2) | 188 | 0 | 0 | 0 |
| [DESIGN-SHEET-VARIANTS-02 · Final UX Refinement · Owner Review](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=525-2) | 195 | 0 | 0 | 0 |

Удалённых и переименованных страниц нет. Версионные страницы листов, геометрии и бренда сохраняются до сопоставления отдельных статусов и внешних ссылок. Legacy References имеет ноль фреймов, но это само по себе не доказывает отсутствие иных узлов или потребности в архиве. Соответствие визуальных состояний прежних Owner Review текущему Approved UI ещё требует сверки.

## Инвентаризация

| Функция | Roadmap | Референс | Прототип и остаток |
| --- | --- | --- | --- |
| Токены, общие компоненты и состояния | UI-00 | [Design System](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=34-2) | PARTIAL. Общие токены, кнопки, меню и окна. Нужна матрица hover/focus/disabled по Approved UI |
| Кампании, настройки и подключение | PB-10/11 (кампании и контекст), PB-12/13 (доступ и медиа) | [Кампании и сохранность](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=468-632) | PARTIAL. Смена кампаний и локальная демонстрация настроек. Продуктовые состояния доступа и восстановления отдельно |
| Стол, чат, токены и партия | B05-PARTY, UI-00 | [Чат](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=208-2), [панель](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=459-607) | PARTIAL. Роли, сцены, группы токенов, контекстные HP и сводка партии. D02/D04 APPROVED как решения, NEEDS REVIEW визуально. Панель над нижней полосой, гид с однократным приглашением |
| Редактор сцены, геометрия и UVTT | PB-14–18 | [Инструменты](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=459-423), [UVTT](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=468-1133) | PARTIAL. Стены, двери, окна, фигуры и локальный импорт, видимый замок для ГМ. Не все пресеты стен и состояния проверены |
| Свет, текущий обзор и разведка | PB-14–16 | [Простой свет](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=504-3), [расширенный](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=504-137) | PARTIAL. Пресеты, ручной FoW, локальная частная разведка и сброс. Индивидуальная разведка MUST, модель текущего обзора и серверная синхронизация OPEN |
| Листы, импорт и создание героя | B05-WIZARD, UI-00 | [Основной](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=104-7), [компактный](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=104-220), [помощник](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=495-23) | PARTIAL. Листы, навыки, ресурсы и помощник. LSS и варианты раскладок оставлены дополнительными предложениями |
| NPC, бестиарий и питомцы | PB-20–21, B05-PET | [NPC](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=463-824), [бестиарий](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=38-3) | PARTIAL. 50 демонстрационных записей, копии и редактирование. Production-каталог содержит 58 проверенных EN записей. Права питомцев сейчас локальные |
| Книга заклинаний | B05-SPELL | [Исторический лист: магия](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=462-808) | IMPLEMENTED как предложение. Общая офлайн-книга, фильтры и ручное копирование. Подтверждённый фрейм глобальной книги нужен |
| Ассеты и декали | PB-19 | [Ассеты](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=468-1374) | PARTIAL. Пять демонстрационных паттернов с размером, поворотом, случайным вариантом, превью и ручной постановкой. Состав и формат результата OPEN. Событийные декали 0.6 и расстановка по области 0.8 — DEFERRED |
| Журнал, книги, ширма и раздатки | PB-22–26, G6 | [Раздатки](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=300-2), [книга](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=41-212) | PARTIAL. Единая модель материалов, показ, шаблоны и получатели. Нужна сверка состояний доступа и уведомлений |
| Бой и броски | T15, UI-00 | [Результат броска](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=457-423) | PARTIAL. Инициатива, быстрые и смешанные броски. T15 проверяется в одной очереди результатов; объёмный и статичный режимы доступны для поддерживаемых кубиков. Источник результата в демо локальный |
| D&D 2024 | F01 / SYS-FOUNDATION | — | DEFERRED до 0.8. На 0.5 рассчитан D&D 2014 |

## Решения владельца

1. **Приоритет вариантов листа — APPROVED (D06).** В рабочем документе есть [Map-safe v0.6](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=135-2) и [Final UX Refinement · Owner Review](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=525-2). D06 закрепил Laterna Map-safe по умолчанию и сохранил Classic и компактный Laterna. Визуальная приёмка раскладок открыта.
2. **PB-19.** D07 закрепил кровь, грязь, следы, каменную россыпь и трещины. Сохраняемый production-формат остаётся в PB-19. Исторический [экран ассетов](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=468-1374). Нужен кадр генератора, если его ещё нет в актуальном файле.
3. **PB-15.** Сохранение разведки утверждено, но у исторических [пресетов и обзора](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=505-3) не подтверждён UX сброса. D05 закрепил сброс выбранного игрока или всей партии только на текущей сцене. Демо показывает число ячеек до и после. Семантику текущего обзора решить отдельно.
4. **Быстрые действия.** Из предыдущего задания подтверждены ссылки на действия листа, порядок и расход. D02 закрепил панель над нижней полосой. Review Mode открывает заполненные состояния обеих ролей и пустую панель.
5. **Прозрачность и resize.** В доступном текстовом задании не было скриншота целевого элемента. В прототипе можно сравнить два режима фона ширмы и менять её размеры в обоих режимах.

Проверены задания и комментарии, доступные в этой переписке, включая предыдущие текстовые задания Design Freeze и следующий раунд. Внешние или удалённые промты не были доступны. OUTDATED-экраны по названиям не назначались.

## Зависимости и прогон

`npm audit`: `esbuild 0.21.5` — moderate, [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), dev-сервер. `vite 5.4.21` — high по агрегату прямых advisories и цепочки esbuild, относится к dev-серверу и раздаче файлов. Автономный собранный HTML не запускает эти серверы. Обновление зависимостей требует отдельной проверки, `audit fix --force` не запускался.

Две дизайн-итерации представлены в текущем прототипе. Stable UI Baseline остаётся открытым до решения владельца по вариантам и до сверки оставшихся состояний.


Скриншоты Chromium: [ГМ 1920×1080](docs/review/gm-1920.jpg), [ГМ 1366×768](docs/review/gm-1366.jpg), [игрок 1920×1080](docs/review/player-1920.jpg), [игрок 1366×768](docs/review/player-1366.jpg). В обоих разрешениях проверены случайный вариант, размер, поворот, постановка, отмена и открытие/закрытие листа клавиатурой при preferred reduced motion.

[Канонический указатель Approved UI](APPROVED_UI.md) содержит точные границы утверждений, классификацию всех страниц и сводный список недостающих состояний.

## Навигация и финальные итерации

[Approved UI в Figma · 605:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=605-2) объединяет 16 ссылок на Approved, WIP и Archive. Исторические страницы и мастера сохранены. Архивные версии обозначены в указателе без переименования страниц и разрыва старых ссылок.

- **Стол.** Быстрые действия доступны обеим ролям. Панель хранит порядок и ссылки на записи листа в модели персонажа. Атака и заряд доступны из панели, магия и способности ведут в лист. У ГМ есть контекстные HP и видимый замок. У игрока остаются разрешённые состояния двери. Генератор показывает параметры результирующей декали и сбрасывает их к исходным.
- **Разведка.** Память демонстрации изолирована по герою, кампании и сцене в localStorage. Сброс через подтверждение ГМ затрагивает выбранного игрока или всю партию на текущей сцене. Текущий обзор остаётся условным и не утверждённым. В production нужен серверный контракт PB-15.
- **Листы.** Classic, Laterna Map-safe и компактный Laterna используют одного актёра. Classic имеет закреплённый HUD, две атаки, HP и временные HP, ресурсы и внутреннюю прокрутку списков. Выбор при создании и LSS доступен. Предпочтение раскладки записывается отдельно по персонажу и кампании в браузере, данные персонажа живут в памяти вкладки. Справка о расположении карточек ведёт в соответствующие вкладки или универсальный редактор. Не проверены все типы нестандартных карточек.
- **Доступность.** Chromium 1920×1080 и 1366×768, смена GM/Player, проверка Esc, reduced motion, раскладок, контекстных сценариев и сброса. Полное сравнение всех окон при произвольном zoom остаётся отдельно.

### Предыдущие реконструкции · ARCHIVE

| Требование | Варианты в интерактивном прототипе | Рекомендуемый вариант |
| --- | --- | --- |
| Прозрачность и resize | Ширма с постоянным фоном или с прозрачностью вне hover/focus через «Гид». В обоих режимах тянется за края. | Фон по умолчанию непрозрачнее, чтобы сохранять читаемость. Полупрозрачность опциональна для открытого стола. |
| Быстрые действия | Панель у левого края либо над нижней полосой. Переключение в «Гид → Варианты отображения». | Левый край сохраняет центр карты во время боя и даёт больше высоты для подписей. |
| Объёмный бросок | Локальная карточка с CSS-кубом d6 либо статичное число. Пример с повтором в «Гид»; реальный одиночный d6 использует карточку. | Короткая анимация в карточке; статичный результат при reduced-motion. Другие многогранники остаются открыты. |
| Интерактивный гид | Быстрое знакомство на два шага и практический маршрут на четыре шага по реальным командам. | Быстрый вариант на входе и практический по запросу. Автозапуск и подсветка отдельных узлов ещё открыты. |

[Действия ГМ](docs/review/quick-actions-1920.jpg) · [Classic](docs/review/classic-1366.jpg) · [Сброс разведки](docs/review/exploration-reset-1366.jpg) · [Объёмный пример](docs/review/guide-volume-1366.jpg) · [Статичный вариант](docs/review/guide-static-1366.jpg).

Кадры предыдущей итерации: [полупрозрачная ширма](docs/review/translucent-screen-1366.jpg) · [быстрые действия у нижней панели](docs/review/quick-actions-docked-1366.jpg).


## Final Design Refinement · кандидат Stable UI Baseline

Все семь решений владельца отражены в [Approved UI](APPROVED_UI.md). Visual status — NEEDS REVIEW. В Figma отдельный [блок D01–D07](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=613-2) ссылается на сохранённые исходные макеты. В браузере [Design Review](http://127.0.0.1:5175/?review=1) запускает каждый сценарий напрямую из одного экземпляра модели прототипа.

| Review | Реализация и способ проверки |
| --- | --- |
| R01 | В листе Элары +4 за Ловкость 18. При старте боя бросается d20 с модификатором, записывается результат и очередь использует отдельно сохранённые итоги. Редактор инициативы позволяет бросить или ввести итог. [Прямой сценарий](http://127.0.0.1:5175/?review=initiative). |
| R02 | Глобальная очередь над листом, d4–d20 и d100, смешанные группы, оба d20, модификатор, итог, натуральные грани, критические атаки и скрытые результаты ГМ. Есть отключение анимации и CSS reduced motion. |
| R03 | Память ограничена ключом кампании, сцены и героя. При выключенной разведке и в режиме ГМ слой не рисуется. Сброс выбранной цели ограничен сценой. Review использует свой ключ. |
| R04 | Один демонстрационный герой для трёх раскладок. Длинное имя, большой инвентарь и магия доступны из прямых сценариев; компактность проверяется при меньшей эффективной площади. Необычные записи используют общие вкладки, заметки и редактор. |
| R05 | README перечисляет память вкладки и настройки браузера. UI-00 описывает порядок адаптации для действующих и будущих контрактов. |

Открыта визуальная оценка читабельности ширмы на свету, плотности панели действий, длительности визуализации и переходов гида. В PB-14/15 остаются модель обзора и серверное хранение. В PB-19 остаётся формат результата. Эти вопросы ограничивают зависимые функции production и не останавливают независимые компоненты UI-01/02.

Скриншоты кандидата: [ширма](docs/review/stable-gm-screen-1366.jpg), [действия ГМ](docs/review/stable-quick-actions-1366.jpg), [действия игрока](docs/review/stable-quick-actions-player-1366.jpg), [Dice Overlay](docs/review/stable-dice-advantage-1366.jpg), [Classic](docs/review/stable-classic-sheet-1366.jpg), [сброс разведки](docs/review/stable-exploration-reset-1366.jpg) и [декали](docs/review/stable-decal-patterns-1366.jpg).

Проверки кандидата: typecheck, валидация 50 профилей SRD, сборка автономного HTML, smoke по 15 прямым сценариям и возврату к обычному столу, регрессии боя, ролей, редактора, NPC, питомцев, материалов и ассетов. Chromium проверял 1920×1080 и 1366×768, включая проекцию 125% через эквивалентный CSS viewport и коэффициент плотности 1,25. Отдельно проверены клавиатурный выход, reduced motion, закрытие очереди бросков, исчерпание зарядов, изоляция разведки и повторное открытие сцены с размещённой декалью.
