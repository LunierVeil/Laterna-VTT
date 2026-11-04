# Работа с Laterna VTT

Self-hosted VTT: FastAPI, React/TypeScript, PixiJS 8, один Zustand-store.
Срез: master `ff9681769978e295a763bcdea8aba536b7967566`; FSD-09b завершён в PR #25.
Перед работой: чистота Git, актуальный master, [архитектура](docs/ARCHITECTURE.md),
[Beta-решения](docs/BETA_DECISIONS.md), [roadmap](docs/ROADMAP.md) и
[разработка/проверки](docs/DEVELOPMENT.md). Не перезаписывать чужие изменения.

- Frontend: app композиция → pages/widgets/features → entities/shared;
  systems/dnd5e предоставляет projections/UI slots, static bindings находятся в app.
  Один плоский store, Session/Campaign/Gameplay/UI; UI использует state/public,
  app/session — ограниченный state/bridge. Entities/shared/systems не импортируют store.
- Backend пока в server/app с основными main.py/handlers.py и доменными helpers.
  Практичный модульный монолит, DataHome и Alembic — утверждённая цель, не реализация.
- Порядок Beta: **A** LOS/базовый свет/FoW → **B** сохранность, DataHome, backup/restore,
  Alembic и постепенный backend → **C** кампании/AccessPolicy → **D** остальные
  обязательные функции Beta C → **E** стабилизация. Если A требует новой схемы или
  несовместимого persistent JSON, сначала необходимая безопасность из B.
- Сервер авторитетен для команд, прав, бросков и проверки секретности/видимости.
  Не выдавать неавторизованным игрокам скрытые объекты, данные ГМ и приватные медиа.
  Сохранять API, seq/cmd_id/base_seq, reconnect и совместимость сохранений.
- PixiJS — renderer; высокочастотные координаты и drag-preview не переносить в Zustand.
  Beta rules engine — D&D 5e 2014; ключи dnd5e/mob сохраняются, SDK не вводится.
- Не менять пользовательские БД/сохранения без явного разрешения. Не выполнять reset,
  reset/clean Git, удаление uploads/ключей/DataHome или down -v для игровых данных.
  Перед разрешённой миграцией — проверяемый backup/restore; исходник Alpha сохранять.
  Тесты используют только изолированные временные DB/uploads/ключи.
- Для затронутых частей — профильные проверки; перед готовым PR — необходимые
  backend/frontend/typecheck/build/Chromium по AGENTS и CI_CD. Не ослаблять assertions,
  counts или gate. Fast CI точного commit SHA — между этапами; Full CI актуального
  test merge + CI required — для ready PR. Fast CI не разрешает merge.
- Commit, обычный push, создание PR, merge и release — только по отдельному разрешению
  владельца в текущей задаче. Не начинать следующий пакет автоматически.
- Все сообщения Git-коммитов — на русском; Conventional Commits допустимы,
  описание после двоеточия — русское. Не публиковать секреты, логи и игровые данные.

Исторические FSD-аудиты/концепции сохраняют свои базы и измерения. APPROVED в
[реестре Beta](docs/BETA_DECISIONS.md) не означает AS-IS; детали OPEN не выбирать
молчаливо. DOCS-00 не разрешает реализацию LOS, backend или миграций.
