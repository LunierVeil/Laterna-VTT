# Области QA Laterna VTT

| Область изменения | Риски и наблюдаемые проверки | Куда смотреть |
| --- | --- | --- |
| Backend, REST/WS и медиа | Сравнить ответы ГМ и игрока, отказ в доступе, отсутствие скрытых объектов и приватных медиа в ответах и рассылках. Для смены прав и reconnect проверить получателей, snapshot и последовательность событий. | [Backend fixtures](../../../../server/tests/conftest.py), Chromium suites auth, scenes и network по [манифесту](../../../../web/tests/browser/run.mjs). |
| DataHome, backup/restore и upgrade | Проверить совместимое хранилище, отказ до записи при чужом владельце или повреждении, сохранность источника, восстановление в новый DataHome. При изменении миграций проверить pre-upgrade gate, прерывание и повтор на синтетических данных. | [Storage preflight](../../../../server/tests/test_storage_preflight.py), [блокировки](../../../../server/tests/test_storage_lock.py), [backup/restore](../../../../server/tests/test_instance_backup.py), [предобновительный gate](../../../../server/tests/test_pre_upgrade.py). |
| Frontend FSD и Zustand | Проверить разрешённые импорты, очистку приватных проекций при смене пользователя, сохранение ожидаемого UI при смене сцены и reconnect. | [Системные границы](../../../../web/tests/system-architecture.test.ts), [границы store](../../../../web/tests/state-architecture.test.ts), [lifecycle](../../../../web/tests/state-lifecycle.test.ts). |
| PixiJS и игровой сценарий | Проверить создание и уничтожение сцены, обработку ошибок и видимый результат действий в Chromium. Выбрать конкретный сценарий по точкам входа и диффу. | [Chromium manifest](../../../../web/tests/browser/run.mjs), [изоляция браузера](../../../../web/tests/browser/fixture.mjs). |
| Клиент и сервер | Сопоставить payload и результат, проверить потерю соединения, повтор запроса или команды и согласованность после snapshot. Проверить идентификаторы команд, seq и отсутствие лишнего применения. | [Протокол](../../../../docs/ARCHITECTURE.md#протокол), Chromium suite network по [манифесту](../../../../web/tests/browser/run.mjs). |

Используй временные fixtures из [DEVELOPMENT](../../../../docs/DEVELOPMENT.md#все-проверки).
Запрос на проверку с реальной кампанией, ключами или чужими данными без полномочий
закрывай на этом входе и подбирай синтетический сценарий. При недоступном окружении
фиксируй пробел покрытия до отчёта.
