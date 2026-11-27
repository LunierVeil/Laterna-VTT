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
| Кампании, настройки и подключение | PB-08C, PB-12–13 | [Кампании и сохранность](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=468-632) | PARTIAL. Смена кампаний и локальная демонстрация настроек. Продуктовые состояния доступа и восстановления отдельно |
| Стол, чат, токены и партия | B05-PARTY, UI-00 | [Чат](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=208-2), [панель](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=459-607) | PARTIAL. Роли, сцены, группы токенов, контекстные HP и сводка партии. Универсальные быстрые действия и обучение остаются |
| Редактор сцены, геометрия и UVTT | PB-14–18 | [Инструменты](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=459-423), [UVTT](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=468-1133) | PARTIAL. Стены, двери, окна, фигуры и локальный импорт, видимый замок для ГМ. Не все пресеты стен и состояния проверены |
| Свет, текущий обзор и разведка | PB-14–16 | [Простой свет](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=504-3), [расширенный](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=504-137) | PARTIAL. Пресеты и ручной FoW. MISSING: сброс и сохраняемая частная разведка. Индивидуальная разведка MUST, модель текущего обзора OPEN |
| Листы, импорт и создание героя | B05-WIZARD, UI-00 | [Основной](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=104-7), [компактный](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=104-220), [помощник](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=495-23) | PARTIAL. Листы, навыки, ресурсы и помощник. LSS и варианты раскладок оставлены дополнительными предложениями |
| NPC, бестиарий и питомцы | PB-20–21, B05-PET | [NPC](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=463-824), [бестиарий](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=38-3) | PARTIAL. 50 демонстрационных записей, копии и редактирование. Production-каталог содержит 58 проверенных EN записей. Права питомцев сейчас локальные |
| Книга заклинаний | B05-SPELL | [Исторический лист: магия](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=462-808) | IMPLEMENTED как предложение. Общая офлайн-книга, фильтры и ручное копирование. Подтверждённый фрейм глобальной книги нужен |
| Ассеты и декали | PB-19 | [Ассеты](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=468-1374) | PARTIAL. Пять демонстрационных паттернов с размером, поворотом, случайным вариантом, превью и ручной постановкой. Состав и формат результата OPEN. Событийные декали 0.6 и расстановка по области 0.8 — DEFERRED |
| Журнал, книги, ширма и раздатки | PB-22–26, G6 | [Раздатки](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=300-2), [книга](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=41-212) | PARTIAL. Единая модель материалов, показ, шаблоны и получатели. Нужна сверка состояний доступа и уведомлений |
| Бой и броски | T15, UI-00 | [Результат броска](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=457-423) | PARTIAL. Инициатива, быстрые и смешанные броски. Объёмная карточка броска и автоматизация производства впереди |
| D&D 2024 | F01 / SYS-FOUNDATION | — | DEFERRED до 0.8. На 0.5 рассчитан D&D 2014 |

## Решения владельца

1. **Приоритет вариантов листа — NEEDS CLARIFICATION.** В рабочем документе есть [Map-safe v0.6](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=135-2) и [Final UX Refinement · Owner Review](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=525-2). Текущая сборка даёт полный и компактный режимы. До пофреймовой сверки статус последнего Owner Review не перенесён на все варианты.
2. **PB-19.** В задании пять видов обязательны, конкретный набор OPEN. В прототипе следы, каменная россыпь, трещины, листва и угли. Варианты — утвердить подборку после прогона или заменить конкретные образцы. Исторический [экран ассетов](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=468-1374). Нужен кадр генератора, если его ещё нет в актуальном файле.
3. **PB-15.** Сохранение разведки утверждено, но у исторических [пресетов и обзора](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=505-3) не подтверждён UX сброса. Демо показывает ручной FoW. Нужна форма подтверждения сброса с выбором цели: один игрок или вся партия. Семантику текущего обзора решить отдельно.
4. **Быстрые действия.** Из предыдущего задания подтверждены ссылки на действия листа, порядок и расход. Сейчас есть быстрые команды стола и контекстные HP. Решение — отдельная полоса действий или вкладка существующего блока. Нужен фрейм пустого и заполненного состояния для обеих ролей.
5. **Прозрачность и resize.** В доступном текстовом задании не было скриншота целевого элемента. Снижен вес линий и добавлены границы ширмы. Нужна отметка на конкретном экране только если подразумевался другой элемент.

Проверены задания и комментарии, доступные в этой переписке, включая предыдущие текстовые задания Design Freeze и следующий раунд. Внешние или удалённые промты не были доступны. OUTDATED-экраны по названиям не назначались.

## Зависимости и прогон

`npm audit`: `esbuild 0.21.5` — moderate, [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), dev-сервер. `vite 5.4.21` — high по агрегату прямых advisories и цепочки esbuild, относится к dev-серверу и раздаче файлов. Автономный собранный HTML не запускает эти серверы. Обновление зависимостей требует отдельной проверки, `audit fix --force` не запускался.

Оценка после пофреймовой сверки — две итерации: сверка стола, инструментов и состояний, затем листы, навигация и проверка адаптивности. Stable UI Baseline остаётся открытым.


Скриншоты Chromium: [ГМ 1920×1080](docs/review/gm-1920.jpg), [ГМ 1366×768](docs/review/gm-1366.jpg), [игрок 1920×1080](docs/review/player-1920.jpg), [игрок 1366×768](docs/review/player-1366.jpg). В обоих разрешениях проверены случайный вариант, размер, поворот, постановка, отмена и открытие/закрытие листа клавиатурой при preferred reduced motion.

[Канонический указатель Approved UI](APPROVED_UI.md) содержит точные границы утверждений, классификацию всех страниц и сводный список недостающих состояний.
