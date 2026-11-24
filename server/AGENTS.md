# Backend Laterna VTT

- Основные точки входа в `server/app` — `main.py` и `handlers.py` с доменными
  helpers. Развивать модульный монолит постепенно.
- Для путей DataHome и startup preflight читать [PB-05](../docs/PB05_DATAHOME.md).
  Для backup/restore — [PB-06](../docs/PB06_BACKUP.md). Для автоматических копий
  и retention — [PB-07 B](../docs/PB07_AUTOMATIC_BACKUP.md). Для предобновительного
  gate и upgrade — [PB-07 C](../docs/PB07_AUTOMATIC_BACKUP.md#pb-07-c--предобновительный-gate).
- Для миграций дополнительно сверять [решения Beta](../docs/BETA_DECISIONS.md#архитектурные-инварианты-и-порядок)
  с ограничениями [реализации gate](app/pre_upgrade.py). При разрешённой миграции
  перед любым изменением данных соблюдать pre-upgrade gate. Windows upgrade
  запрещён до подтверждения контракта долговечной публикации.
