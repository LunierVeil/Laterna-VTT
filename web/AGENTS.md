# Frontend Laterna VTT

- Композиция в `app` → `pages` / `widgets` / `features` → `entities` / `shared`.
  `systems/dnd5e` предоставляет projections и UI slots. Статические bindings находятся в `app`.
- Один плоский Zustand store с областями Session/Campaign/Gameplay/UI. UI использует
  `state/public`, `app/session` — ограниченный `state/bridge`.
  `entities`, `shared` и `systems` не импортируют store.
- PixiJS рисует сцену. Границу безопасности определяет сервер. Высокочастотные
  координаты и drag-preview остаются вне Zustand.

Для изменений границ или lifecycle см. [FSD](../docs/FSD_SYSTEM_BOUNDARIES.md)
и [матрицу состояния](../docs/STATE_LIFECYCLE.md).
