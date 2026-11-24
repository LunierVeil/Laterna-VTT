# Матрица внедрения Codex Workflow

Аудит от 24.11.2026. Методики изучены по [Claude Code Ultimate Guide][repo]
Флориана Брюньо на `3fd3e805ffca92a5e69813daf46912a645cd549b`. В `guide/core/`
описаны контекст, модель агента и интеграции. `guide/workflows/` описывает
разработку и проверку изменений. `guide/roles/`, `guide/security/` и `guide/ops/`
содержат оценку агентов, защиту и метрики. В `examples/` собраны образцы реализации.

[LICENSE][license] распространяет гайд на условиях CC BY-SA 4.0.
[README][readme] отдельно указывает CC0 1.0 для переиспользуемых шаблонов.
Для заимствования конкретного файла нужно установить применимые условия,
включая отдельные notices и права на вложенный контент. Workflow-01–03 используют
ссылки и самостоятельно написанные инструкции Laterna. Текст, скрипты и
конфигурации из гайда в репозиторий не переносились.

**Прямо** означает перенос практики как процесса. **Адаптация** использует
механизм Codex или действующий контракт Laterna. **Несовместимо** относится
к формату или семантике Claude. **Вне scope** отмечает технически возможные
варианты, исключённые из внедрения. P0 — безопасность или обязательный процесс,
P1 — практическая экономия работы, P2 — эксперимент. Имена файлов будущих этапов
ориентировочные. `CODEX_WORKFLOW.md` и `TASK_TEMPLATE.md` находятся рядом с матрицей.

| Возможность и источник | Решение для Laterna и Codex | Приоритет | Целевые файлы | Workflow |
| --- | --- | --- | --- | --- |
| Правила и маршрутизация контекста · [Context Engineering][context] | Адаптация. Общие гарантии в корневом AGENTS. Codex собирает цепочку до CWD при запуске, поэтому при входе из корня нужны явные указатели на инструкции модулей. [Codex AGENTS][codex-rules] | P0 | `AGENTS.md`, `server/AGENTS.md`, `web/AGENTS.md` | 01 |
| Чтение по запросу · [Context Engineering][context] | Прямо. Выбирать разделы по контракту и сохранять пути, символы и SHA для повторного использования. | P1 | `.agents/skills/task-start/SKILL.md`, `CODEX_WORKFLOW.md` | 01 |
| Начало задачи и границы · [Spec-First][spec], [Plan-Driven][plan] | Прямо. Сверить Git и PR, выписать критерии, модули и точку остановки. | P0 | `.agents/skills/task-start/SKILL.md`, `TASK_TEMPLATE.md` | 01 |
| Skills и постепенная загрузка · [Skill Design Patterns][skills] | Адаптация. Репозиторные `.agents/skills/<name>/SKILL.md`, YAML `name` и `description`, явный вызов `$имя`. Подробности доступны по ссылкам. [Codex Skills][codex-skills] | P1 | `.agents/skills/*/SKILL.md` | 01 |
| Минимальная спецификация · [Spec-First][spec] | Прямо. Наблюдаемые критерии с проверками, границы и открытые решения. | P1 | `TASK_TEMPLATE.md`, `CODEX_WORKFLOW.md` | 01 |
| План отдельно от исполнения · [Plan-Driven][plan] | Адаптация. Прямая реализация однозначной правки. Для сложной задачи применим CLI `/plan` и проверяемые этапы. [Команды Codex][codex-cli] | P1 | `CODEX_WORKFLOW.md` | 01 |
| Передача контекста · [Session Handoff][handoff], [пример записи][create] | Адаптация. Краткая запись Laterna в корневом игнорируемом каталоге, без чувствительных данных и транскрипта. | P0 | `.agents/skills/handoff-create/SKILL.md`, `.gitignore`, `CODEX_WORKFLOW.md` | 01 |
| Возобновление · [пример продолжения][resume], [Memory Systems][memory] | Адаптация. `codex resume` открывает доступную историю. Handoff пригоден и в новой сессии. Его данные сверяются с Git и PR, а полномочия задаёт текущее задание. [Команды Codex][codex-cli] | P0 | `.agents/skills/handoff-resume/SKILL.md`, `CODEX_WORKFLOW.md` | 01 |
| Самопроверка и независимое review · [Code Review][review] | Адаптация. Встроенный `/review` помогает в самопроверке. Независимое архитектурное review привязано к PR и полному HEAD. [Команды Codex][codex-cli] | P0 | `AGENTS.md`, `.agents/skills/pr-preflight/SKILL.md`, `CODEX_WORKFLOW.md` | 01 |
| Доказательства проверок · [Code Review][review], [Agent Evaluation][eval] | Адаптация. Diff и локальные результаты с привязкой к исходникам, Fast CI push HEAD, отдельный Full CI test merge и CI required. | P0 | `.agents/skills/pr-preflight/SKILL.md`, `CODEX_WORKFLOW.md` | 01 |
| Sandbox, approvals и доверие · [Security Hardening][security] | Адаптация. Проверять происхождение инструкций и применять ограничения Codex вместе с действующими границами прав, данных и публикации. [Codex Security][codex-security] | P0 | `AGENTS.md`, `.agents/skills/*/SKILL.md` | 01 |
| Спецификация контрактов · [Spec-First][spec], [Plan-Driven][plan] | Прямо. Протокол, права, совместимость и связь критериев с проверками. | P1 | [spec-first](../../.agents/skills/spec-first/SKILL.md) | 02, реализовано |
| Red → Green → Refactor · [TDD][tdd] | Прямо. Воспроизводимый тест, минимальное исправление, профильный прогон. | P1 | [tdd](../../.agents/skills/tdd/SKILL.md) | 02, реализовано |
| QA и доказательства для ревью · [Reviewable Agent Changes][reviewable], [Code Review][review], [Production Reliability][reliability] | Адаптация. Риск-ориентированная матрица, изолированные fixtures и выводы со ссылками на проверки и пробелы покрытия. | P0 | [qa](../../.agents/skills/qa/SKILL.md) | 02, реализовано |
| Диагностика CI · [GitHub Actions][actions], [Production Reliability][reliability] | Адаптация. Проверка фактических Actions run, попытки, SHA и обязательных jobs без автоматической публикации или обхода gate. | P0 | [ci](../../.agents/skills/ci/SKILL.md) | 02, реализовано |
| Специализированные агенты · [Agents][agents] | Адаптация. Четыре проектные роли с общим отчётом, родительскими sandbox и approvals и лимитом двух потоков. Регистрация и запуск подтверждены в CLI 0.171.0. [Codex Subagents][codex-agents] | P1 | `.codex/agents/`, `.codex/config.toml`, [свидетельства](WORKFLOW_03_VALIDATION.md) | 03, реализовано |
| Локальные hooks · [Hooks Events Reference][hooks] | Адаптация. Один advisory Stop для staged/unstaged diff и напоминание о ручной проверке Markdown. CLI обнаруживает конфигурацию, запуск через доверенный жизненный цикл ещё требует smoke. [Codex Hooks][codex-hooks] | P1 | `.codex/hooks.json`, `scripts/codex_hooks/check_changes.py`, [проверки](WORKFLOW_04_VALIDATION.md) | 04, пилот |
| Аудит контекста · [Context Engineering][context] | Адаптация. Сравнить размер обязательного контекста, повторные чтения и конфликты на одинаковых задачах. | P1 | `docs/agent-workflow/CONTEXT_AUDIT.md` | 05 |
| Оценка навыков и агентов · [Agent Evaluation][eval], [Team Metrics][metrics] | Адаптация. Повторять обезличенные сценарии с фиксированными условиями и версией CLI. Измерять соблюдение гарантий, повторную работу, время и доступные показатели контекста. | P1 | `docs/agent-workflow/EVALUATION.md` | 05 |
| Внешние интеграции · [Memory Systems][memory], [Security Hardening][security] | Вне scope Workflow-01. MCP, плагины, телеметрия и стороннее хранение требуют обоснованной потребности и отдельного разрешения. | P2 | `docs/agent-workflow/EVALUATION.md` для записи решения | 05, решение |
| Claude-инструкции и команды · [Skills][skills], [Agents][agents], [пример][resume] | Несовместимо напрямую. `CLAUDE.md`, `.claude/commands`, `.claude/agents`, `argument-hint`, `$ARGUMENTS` и permission modes имеют собственную семантику. | P0 | — | Исключено |
| Claude hooks и автономные циклы · [Hooks][hooks], [Loop & Graph Engineering][loops] | Формат `.claude/settings.json`, payload и ответы hooks несовместимы напрямую. Автоповторы исправлений, автоматическое одобрение и обход gate исключены. | P0 | — | Исключено |
| Внешние фреймворки spec/review · [Spec-First][spec], [Code Review][review] | Вне scope. Для указанных этапов достаточно Git/GitHub, Markdown, Codex и существующих проверок. | P2 | — | Исключено |

## Аудит инструкций Laterna

На основе master `273564a83455895febd5a1b4b9e57ed3a7f56f0e`:

- В корне сохраняются Git, review, CI, серверная авторизация и секретность,
  защита сохранений, migration gates и исторические ограничения.
- Контракты FSD/Zustand/PixiJS применяются из `web/AGENTS.md`. Точки входа
  backend и маршрутизация к контракту хранилища находятся в `server/AGENTS.md`.
  Корень указывает на оба файла для задач, охватывающих несколько каталогов.
- Из `docs/DEVELOPMENT.md` убран повтор Git-процедуры. Ссылки на разделы по задаче
  заменяют полное перечитывание четырёх справочников. Команды проверок и сведения
  о Ruleset сохраняются в профильных документах. Workflow-05 измерит экономию
  контекста на сопоставимых задачах.

[reviewable]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/workflows/reviewable-agent-changes.md
[reliability]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/workflows/production-reliability.md
[actions]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/workflows/github-actions.md
[repo]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/tree/3fd3e805ffca92a5e69813daf46912a645cd549b
[readme]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/README.md#license
[license]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/LICENSE
[context]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/core/context-engineering.md
[skills]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/core/skill-design-patterns.md
[agents]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/ultimate-guide.md#4-agents
[hooks]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/core/hooks-events-reference.md
[spec]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/workflows/spec-first.md
[plan]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/workflows/plan-driven.md
[tdd]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/workflows/tdd-with-claude.md
[handoff]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/ultimate-guide.md#session-handoff-pattern
[create]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/examples/skills/handoff-create/SKILL.md
[resume]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/examples/skills/handoff-resume/SKILL.md
[review]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/workflows/code-review.md
[eval]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/roles/agent-evaluation.md
[security]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/security/security-hardening.md
[metrics]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/ops/team-metrics.md
[loops]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/core/loop-graph-engineering.md
[memory]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/3fd3e805ffca92a5e69813daf46912a645cd549b/guide/core/memory-systems.md
[codex-rules]: https://learn.chatgpt.com/docs/agent-configuration/agents-md
[codex-skills]: https://learn.chatgpt.com/docs/build-skills
[codex-cli]: https://learn.chatgpt.com/docs/developer-commands?surface=cli
[codex-agents]: https://learn.chatgpt.com/docs/agent-configuration/subagents
[codex-hooks]: https://learn.chatgpt.com/docs/hooks
[codex-security]: https://learn.chatgpt.com/docs/agent-approvals-security
