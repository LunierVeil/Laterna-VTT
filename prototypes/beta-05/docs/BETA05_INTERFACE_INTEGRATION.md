# UI-00 · рабочая карта переноса Beta 0.5

Рабочий документ прототипа. Production-срез — master `7a35500e85175c0e3d4f57715f3e71ad134bedaf`. Figma nodes ниже исторические, их утверждение требует сверки с доступным Approved UI.

| Очередь и компоненты прототипа | Figma | Production и перенос | Контракты и зависимости |
| --- | --- | --- | --- |
| 1. Shared UI, Workbench, FloatingWindow, Chrome | [Компоненты](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=34-2), [панель](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=459-607) | `web/src/widgets/table-header/ui/TopBar.tsx`, `widgets/sidebar/ui/Sidebar.tsx`. Адаптировать токены, клавиатурные состояния и оболочки окон | Клиентский слой независимо от backend |
| 2. Board, Inspector, LightingPanel, DecalPatterns | [Инструменты](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=459-423), [свет](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=504-137), [ассеты](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=468-1374) | `widgets/scene-canvas/ui/SceneView.tsx`, `WallProperties.tsx`, `features/scene-tools`, `widgets/token-inspector/ui/TokenCard.tsx`. Сохранить PixiJS и Zustand. Предпросмотр может быть клиентским | PB-12–19. Серверные проекции видимости и разведки, медиа, авторитетные изменения сцены, UVTT через PB-17A и атомарную публикацию |
| 3. Sheet, Roster, HeroCreation, GlobalSpellbook | [Лист](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=104-7), [создание](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=495-23), [NPC](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=463-824) | `widgets/character-sheet/ui/CharacterSheet.tsx`, `features/character-management`, `entities/character` и `entities/token`. Стили и раскладки можно адаптировать независимо | PB-12, PB-20A/B1, PB-21. Канонический PC/NPC, HP экземпляра, ownership, серверные проекции. Проверенный каталог production сохраняется |
| 4. Materials, Screen, Activity, DiceOverlay | [Раздатки](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=300-2), [броски](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=457-423) | `features/chat`, `features/dice`, `widgets/combat-tracker/ui/InitiativePanel.tsx`. Материалы получают общую поверхность по G6. Шаблоны, фильтры и компоновку можно готовить отдельно | PB-12–13, PB-22–26. REST/WS проекции G2, права показа/поиска и отзыв доступа. Результат броска и очередность авторитетны на сервере |

Сохраняются production FSD, PixiJS, Zustand и действующие контракты. `usePrototype`, SVG-видимость, локальные проверки доступа, броски и демопарсеры остаются в демо. Данный документ задаёт классы необходимых контрактов. Конкретные новые endpoints и WS-события требуют отдельного архитектурного решения и задания.


## Действующие контракты и будущие

| Плоскость | Уже существует в production-срезе | Требует отдельного контрактного решения |
| --- | --- | --- |
| Кампания и активная сцена | SceneSocket и типы протокола в `web/src/shared/api/scene-socket.ts` и `protocol.ts`, панель сцен `features/scene-management/ui/ScenesPanel.tsx` | PB-10/11 — управление контекстом активной кампании. PB-12/13 — доступ к объектам и медиа, отзыв и превью. |
| Сцена и медиа | Чтение `GET /api/scenes/{sceneId}` и загрузка `POST /api/uploads` из существующего клиента | Сохраняемый свет и обзор PB-14, приватная разведка и сброс PB-15, результат декали PB-19. |
| Листы, инициативы и чат | Существующие UI-компоненты и SceneSocket. Рабочие протоколы остаются источником событий | Ownership питомца и состояние экземпляра PB-21, обработка общих материалов PB-22–26 и согласованные права PB-12/13. Новый UI не вводит endpoints. |
