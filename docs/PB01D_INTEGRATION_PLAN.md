# PB-01d — завершение вычислительного этапа и функциональная интеграция

База: master `baa7695ff4654c3317cd5143b05fd7bf8cba83d0` после обычного
[merge PR #37](https://github.com/LunierVeil/Laterna-VTT/pull/37).
[Full CI master](https://github.com/LunierVeil/Laterna-VTT/actions/runs/42112696994)
успешен: backend/frontend, Chromium 9/8/5/16 (38), CI required. Изолированные
PB-01d-1/2/3 приняты; повторный рефакторинг вычислительного ядра не требуется.
Это docs-only уточнение порядка по Owner Decision, не утверждение всех runtime gates.

## Завершено — только изолированный экспериментальный scope

| Этап | Результат | Сохранённая граница |
| --- | --- | --- |
| [PB-01d-1](PB01D_VISIBILITY_AREA.md), [PR #35](https://github.com/LunierVeil/Laterna-VTT/pull/35) | Событийный approximate_zero_width contour, exact point truth | Не маска FoW/авторизации/раскрытия объектов; не интерактивный массовый расчёт |
| [PB-01d-2](PB01D_BASIC_LIGHTING.md), [PR #36](https://github.com/LunierVeil/Laterna-VTT/pull/36) | Бинарный point light, explicit ambient, OR источников | Нет реальных source records, mapping старых полей или игровых правил зрения |
| [PB-01d-3](PB01D_COMPUTATION_CONTEXT.md), [PR #37](https://github.com/LunierVeil/Laterna-VTT/pull/37) | Immutable context, локальные бюджеты/отмена/поколения, SQLite probes | Нет trusted DB source adapter, глобального scheduler или безопасной сетевой публикации |

Все три этапа прошли review **PASS WITH RISKS** в этих границах. Динамический свет
в игре, automatic FoW и сохраняемая разведка **не готовы**. D10/D11 для runtime,
W3, personal/shared vision и D05/D06 source mapping не объявляются полностью APPROVED.
Production SLA отсутствует; вычислительный COMPLETE/CLEAR не является разрешением выдачи секретов.

## Утверждённый рабочий приоритет владельца

Основная платформа разработки и ручных тестов — **CachyOS / Arch Linux, Linux-first**.
Цель ближайших примерно 3–4 функциональных PR — игровой сценарий, а не ещё один
цикл предварительных исследований:

1. Завершить LOS от сервера до интерфейса и игровой свет.
2. Реализовать automatic FoW **вместе с обязательной сохраняемой разведкой**.
   Текущая видимость и память разведки — части одной полноценной возможности Beta 0.5.
3. **Перед первым новым несовместимым persisted-изменением**, даже внутри пунктов
   1–2, выполнить необходимый DataHome/Alembic/verified backup/restore/Alpha upgrade gate.
   Новые source/revision/media records не обходят этот gate; исходник Alpha сохраняется.
4. Затем остальной утверждённый функционал Beta 0.5 / расширенной Beta C.
5. Модульные границы соблюдать параллельно реализации каждой возможности.
6. Затем завершение модульного монолита и стабилизация.

Отдельные **I-01a/I-01b**, Windows benchmark, полноценный глобальный scheduler,
process isolation и окончательные performance SLA **не являются prerequisite PB-02**.
Они отложены до конкретной технической необходимости. Это не разрешает fail-open,
неограниченный расчёт в event loop или игнорирование OPEN design gates.
Windows compatibility/performance acceptance сохраняется перед соответствующим
релизным gate; Linux-first не отменяет принятые требования к выпуску.

## Уже начатый PB-02 и следующие функциональные срезы

[Draft PR #39](https://github.com/LunierVeil/Laterna-VTT/pull/39) уже содержит первый
экспериментальный **permission/projection slice**: opt-in серверный путь,
GM layer/manual FoW, recipient checks и protected media. Рассмотренная база PR —
`51cc8f816ceea6187e7d84222acacd06c36f27d0`; исправления review выполняются в том же PR.
Этот результат **не завершает игровой LOS**, не подключает стены/двери к выдаче NPC
и не является всей реализацией G2/AccessPolicy. Draft и Fast CI не заменяют
независимое review, Full CI актуального test merge и ручную игровую приёмку.

| Функциональный результат | Что проверить в том же PR |
| --- | --- |
| Первый permission/projection slice — #39 | Initial WS publication, свежесть session/role/scene, безопасный REST denial, private media/known-ID/rollback и существующие GM/manual FoW потоки |
| Подключение существующего точного LOS к NPC и двери | Trusted capture, bounded fail-closed, revalidation перед выдачей, отзыв/recipient updates, REST/WS/snapshot/resync/media без обхода |
| Минимальная frontend интеграция и полный игровой regression | Два игрока и GM, дверь open/closed/locked, поздний результат, reconnect/scene change; ручной CachyOS сценарий и отсутствие утечки защищённых данных |
| Игровой свет, затем automatic FoW и сохраняемая разведка | Source/vision/memory design gates по фактическому scope; migration gate до новых persisted данных; server privacy и renderer/resource regressions |

Минимальные trusted snapshot, revalidation, permission/projection и fail-closed
механизмы реализуются **внутри соответствующих функциональных PR**. Отдельный
малый prerequisite допустим при доказанной необходимости, но не общий infrastructure
rewrite. Не навязывать отдельный архитектурный PR, если безопасно переиспользовать
существующие интерфейсы. Связанные срезы можно объединять; PB ID и продуктовый scope
при этом сохраняются. Этот документ сам не начинает следующий функциональный PR.

## Сохраняемые design gates и границы безопасности

| Область | Что допустимо сейчас | Что не утверждено |
| --- | --- | --- |
| D10 | Консервативные временные бюджеты ограниченного экспериментального сценария, явный busy/unavailable и fail-closed; измерения на целевом Linux | Production SLA, fairness/admission всех процессов, универсальный scheduler, hard CPU/memory stop |
| D11 | Минимальный trusted DB read и повторная проверка актуальности/получателя в функциональном PR; закрыть read transaction до network send | Безопасность произвольных внешних live writers, межпроцессная linearization и универсальный DB→network publication fence |
| D05/D06 | Сохранение изолированного API явных источников | Persisted scene/token source mapping, DDL/backfill и переинтерпретация emits_light/vision_range |
| W3 и vision | Существующие утверждённые обычные стены/двери, отдельный ограниченный тестовый сценарий | Оптика окон, shared/personal general vision и exploration; новые D&D rules |
| FoW | Планировать current и explored как единую обязательную возможность | Автоматическая память разведки не становится готовой из-за ручного FoW или approximate contour |

Физический SQLite read snapshot обеспечивает согласованное чтение, но не вечную
свежесть результата. После вычисления нужны актуальные scope/session/role/scene и
state checks. Один seq, object identity, hash или PRAGMA data_version сами по себе
не доказывают безопасность публикации и не закрывают ABA/logout/revoke races.
Неожиданная/неподдерживаемая запись не должна расширять выдачу. Нет разрешения
поддерживать произвольные внешние writers без отдельного доказанного механизма;
нужный persisted revision/trigger также проходит migration gate.

Internal ContextVersion/capture не клиентский DTO. Сохраняются seq/cmd_id/base_seq,
noops, snapshot/join ordering и reconnect. Не отправлять независимые изменения с
повторным seq и не выбирать новый LOS/WS-протокол молча. Approximate polygon не
использовать для авторизации/FoW. Уже законно доставленные данные нельзя «забыть».

## Первый сценарий непосредственно в игре и доказательства

GM, два игрока с одним своим персонажем у каждого, NPC за обычной стеной с дверью;
explicit ambient full, без новых источников и automatic FoW:

1. GM видит NPC; игрок за закрытой/запертой дверью не получает его защищённый DTO.
2. Open показывает NPC, close отзывает; запоздавший результат не возвращает NPC.
3. REST, WS, snapshot/resync и связанные приватные данные не обходят защиту.
4. Существующие движение, GM layer/manual FoW, seq/cmd_id, initiative и reconnect сохранены.
5. Проверены отрицательные security tests, Chromium и ручной запуск на CachyOS.

Измерять capture/preparation/queries/revalidation/projection отдельно; 30/200/15 —
нагрузочный профиль, не SLA. Достаточность выборки и лимиты подтверждаются фактически,
не тремя benchmark-прогонами. Windows-проверки выполняются к соответствующему
релизному gate, без автоматического запуска release workflow этим планом.

## Формальная синхронизация документов — отдельно для Owner Review

[ROADMAP](ROADMAP.md), [Beta-решения](BETA_DECISIONS.md), LTR-DEC и G1–G6 этим PR
не редактируются и не переутверждаются. Предложение для отдельного Owner Review:
уточнить их описание рабочего порядка с учётом приоритета LOS/свет → полноценный FoW
с памятью → остальные Beta features, сохранив обязательную вставку необходимого B
**до** любого несовместимого persisted-изменения и модульность на каждом этапе.
Это не отменяет A→E как историческую модель зависимостей и не переносит обязательные
функции Beta в будущие версии. Новые design gates должны быть согласованы до
соответствующей реализации, без новых обязательных I-предисследований по умолчанию.
