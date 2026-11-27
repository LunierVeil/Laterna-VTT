# Laterna Beta 0.5 · указатель Approved UI

Рабочий документ: [Laterna UI Design System](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY/). [Дополнительный Approved UI](https://www.figma.com/design/3yKyawoQXmuC0TAcCl8Zd3/) вернул отказ доступа. Ни одна страница из недоступного файла не классифицирована.

Этот указатель выбирает один адрес на каждое подтверждённое решение. Статус относится только к тому объёму, который назван в самом решении. Номер версии, суффикс Final и проход браузерных тестов сами по себе статус не меняют.

## Подтверждённый визуальный и UX-контракт

| Область | Канонический адрес | Граница решения |
| --- | --- | --- |
| Основной знак | [Micro без ореола · 280:78](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=280-78), [решение владельца · 281:5](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=281-5) | Full и Compact остаются дополнительными эмблемами. Ранние фонари не являются заменой Micro. |
| Семантика иконок | [Контракт 97 назначений · 247:526](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=247-526) | 97 подтверждённых соответствий глифов. Принятие иконки не утверждает соответствующую функцию и её сценарии. |
| Геометрия и правая панель | [Глифы геометрии · 459:423](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=459-423), [правая панель · 459:805](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=459-805), [инструмент «Выбор» · 220:260](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=220-260) | В B09 каноничен AFTER. BEFORE исключён из списка целей. APPROVED относится к указанным глифам и сравнению, а не ко всей странице Owner Review. |
| Select | [React Spec · 36:32](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=36-32) | Нативный select — утверждённая база. Макет custom combobox показывает перспективное состояние. Явные текстовые ошибки и клавиатурный фокус входят в контракт. |
| Classic 2014 | [Handoff D01–D04 · 528:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=528-2) | Утверждены критерии D01–D04: настройка по characterId, компактный размер 1100×720, sticky боевой HUD, отдельные прокрутки, один набор данных, fallback незнакомой карточки и доступность. Итерация целиком помечена Owner Review. Этот handoff не отменяет автоматически Map-safe и не утверждает все картинки страницы. |

**Решения по функциям.** Индивидуальная сохраняемая разведка, базовый свет и пять паттернов декалей относятся к обязательному объёму; конкретные визуальные пресеты света и модель текущего обзора имеют открытые вопросы. Книга заклинаний, фамильяры, мастер создания и базовая панель партии остаются дополнительными предложениями. [Контракты и соответствие прототипу](DESIGN_AUDIT.md)

## Решения владельца D01–D07 · Stable UI Baseline candidate

Владелец утвердил требования ниже. Каждый обновлённый экран находится в **NEEDS REVIEW** до визуальной приёмки. [Записи D01–D07 в Approved UI Figma](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=613-2).

| Решение | Утверждённый сценарий | Figma | Демо |
| --- | --- | --- | --- |
| D01 | Полупрозрачная ширма по умолчанию, сплошной фон по выбору, свободное перемещение и размер | [613:5](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=613-5) | [?review=gm-screen](http://127.0.0.1:5175/?review=gm-screen) |
| D02 | Быстрые действия над нижней полосой, роли, закрепление, порядок и видимость ресурсов | [613:6](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=613-6) | [ГМ](http://127.0.0.1:5175/?review=quick-actions), [игрок](http://127.0.0.1:5175/?review=quick-actions-player), [пусто](http://127.0.0.1:5175/?review=quick-actions-empty) |
| D03 | T15, единая очередь результатов, короткий объёмный эффект, статичный режим | [613:7](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=613-7) | [?review=dice-overlay](http://127.0.0.1:5175/?review=dice-overlay) |
| D04 | Однократное необязательное приглашение и гид с практикой по ролям | [613:8](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=613-8) | [первый вход](http://127.0.0.1:5175/?review=guide), [практика игрока](http://127.0.0.1:5175/?review=guide-player) |
| D05 | Сброс памяти выбранного игрока или партии на текущей сцене | [613:9](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=613-9) | [?review=exploration-reset](http://127.0.0.1:5175/?review=exploration-reset) |
| D06 | Laterna Map-safe по умолчанию, компактный Laterna и Classic 2014 на общей модели | [613:10](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=613-10), [Classic Handoff 528:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=528-2) | [Map-safe](http://127.0.0.1:5175/?review=laterna-sheet), [компактный](http://127.0.0.1:5175/?review=compact-sheet), [Classic](http://127.0.0.1:5175/?review=classic-sheet) |
| D07 | Кровь, грязь, следы, каменная россыпь и трещины | [613:11](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=613-11) | [?review=decal-patterns](http://127.0.0.1:5175/?review=decal-patterns) |

Ссылки Figma ведут на записи решения и связанные исходные фреймы. Для нового гида, панели действий, результатов T15 и подтверждения сброса интерактивный сценарий показывает более свежую реализацию. Исторические страницы, компоненты и переходы сохранены.

## Все 24 страницы и порядок сохранения

| Страница | Роль в указателе и причина сохранения |
| --- | --- |
| [0:1](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=0-1) | UI Kit, исходные мастера и токены. Сохранить. |
| [6:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=6-2) | Legacy References. Внутри архив 6:3 с уникальными ссылками и референсами. OUTDATED для реализации, сохранён как архив. |
| [28:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=28-2), [34:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=34-2), [36:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=36-2) | Masters, Overview, React Spec. Это исходники, атлас и контракт соответственно. Сохранить все три. |
| [64:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=64-2), [78:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=78-2), [276:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=276-2) | Концепции фонаря и исследование по постерам остаются историей. Точка входа для основного знака только Micro. Страницы содержат мастера и инстансы. |
| [86:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=86-2), [104:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=104-2), [117:266](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=117-266), [135:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=135-2) | Исходный UX-аудит, навыки и спасброски, порядок навыков, Map-safe. Сохранить раздельные задачи, masters и интерактивные переходы. |
| [166:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=166-2), [187:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=187-2), [207:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=207-2), [218:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=218-2) | Последовательные итерации редактора. Исторические сравнения и интерактивные цепочки сохранены. Для глифов применяются только адреса из канонической таблицы. |
| [233:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=233-2), [263:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=263-2) | Семантическая библиотека и UX Fixes с экземплярами. Контракт иконок и визуальные примеры сохраняются. |
| [300:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=300-2), [451:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=451-2) | Раздатки и общий Owner Review. Сохранить отдельные сценарии материалов, NPC и подтверждённых глифов. |
| [495:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=495-2), [501:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=501-2) | Прогрессия, инвентарь и свет. Сохраняются разрезы простого и расширенного света. Пресеты и анимации явно PROPOSED. |
| [514:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=514-2), [525:2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=525-2) | Исследование раскладок и уточнения Classic. D01–D04 вынесены в указатель, варианты сохранены как Owner Review. |

Проверены типы узлов, маркеры статуса, наличие masters/sets/instances и prototype reactions в основном файле. В доступной проверке совпадений имени и размера верхнеуровневых фреймов не обнаружено. Это не доказательство отсутствия визуальных дублей. Версионные страницы исключены из списка канонических адресов там, где есть конкретное принятое решение. Удалений и переносов в Figma не было: страницы содержат уникальные материалы, а эквивалентность версий с сохранением зависимостей не подтверждена. Перед будущим удалением потребуется проверяемая копия и проверка переходов и ссылок на мастера.

## Макеты и состояния, которых не хватает для уверенной реализации

| Область | Что закрывает вопрос |
| --- | --- |
| ГМ и игрок на столе | Общая полоса быстрых действий с добавлением, пустым состоянием и расходом, контекст токена с доступными и недоступными командами. |
| Стены и двери | Матрица геометрии, замка и значка двери по ролям, расстоянию и видимости. Существующий прототип показывает эти состояния локально. |
| Разведка | Экран частной разведки после возврата в кампанию, сброс ГМ с подтверждением и показ результата игроку. Отдельный кадр текущего обзора. |
| Декали PB-19 | Утвердить конкретные пять паттернов и кадр выбора, размера, поворота, случайного варианта и постановки. |
| Компактный Classic 2014 | Проверяемый комплект 1100×720 со sticky HUD, отдельными прокрутками, длинными именами, fallback неизвестной карточки и выбором после импорта. Нужны парные состояния Laterna ↔ Classic на одних данных. |
| Книга магии и питомцы | Глобальная книга со всеми полями и недоступным действием. Создание, размещение и отзыв управления питомцем в двух ролях. |
| Материалы | Получение раздатки, непрочитанное состояние, отзыв доступа и пустые шаблоны документа. |
| Текстовые задания без достаточной привязки | Уточнить целевой элемент для прозрачности и resize только если правки линий, линейки и ширмы не соответствуют замыслу. Дать кадры объёмного броска с reduced motion и быстрого/расширенного гида. |

## Gameplay First UX · NEEDS REVIEW

Предыдущие решения и варианты сохранены. Карточки сравнения в существующем Approved UI фиксируют источник требований, исходный фрейм и ссылку на живую сцену. [Указатель Gameplay First](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=627-2).

Новые реализации быстрых действий, ширмы, кубиков, гида, HP HUD, Classic A/B и пяти декалей ждут визуальной приёмки. Laterna Map-safe остаётся основным оформлением. Classic B и три направления T15 предназначены для выбора владельцем. [Сравнение и аудит операций](DESIGN_AUDIT.md#gameplay-first-ux--новая-визуальная-приёмка).

[Схемы Classic A/B и Dice Overlay](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=630-2). В Figma сохранены 24 страницы. Полноразмерные интерактивные состояния сравниваются в локальном Review.
