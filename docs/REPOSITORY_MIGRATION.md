# Перенос Laterna VTT: подготовка и согласованное переключение

**Статус: подготовка.** Ни rename/archive/delete GitHub, ни создание нового публичного repo, ни commit/push/tag/release здесь не разрешены. Следующие команды изменения GitHub и первого commit/push - инструкция для выполнения ТОЛЬКО после отдельного согласования. На первом этапе имя LunierVeil/Laterna-VTT было занято исходным проектом. Теперь Alpha Legacy уже переименован; повторять rename не нужно. Следующие разделы сохраняют воспроизводимую историю подготовки, а текущий этап — очистка отдельного snapshot перед Initial Commit.

Функциональная альфа остаётся в старой полной истории. Новый проект будет содержать актуальный снимок исходников и один root commit `Initial commit: Laterna VTT Alpha`; история Alpha Legacy не входит в его Git-граф. Не использовать merge несвязанных историй, force-push или перенос старых тегов.

## 1. Проверить исходное состояние

```bash
git status --short
git branch -a
git rev-parse HEAD
git show-ref
git ls-remote --refs origin
git config --show-origin --get user.name
git config --show-origin --get user.email
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
```

На старте этой подготовки: master `187b8191d64b852e7a497a43f6fe3f2f7913945e`, рабочее дерево чистое. Последняя альфа уже committed/pushed. Remote: master и fix/bugs-regressions-mobile, три тега v0.1.0-alpha/v0.1.1-alpha/v0.1.2-alpha. Локально дополнительно work; локальная копия не содержит v0.1.0-alpha. Поэтому одного локального clone недостаточно для полного backup удалённых ссылок. Новые изменения инфраструктуры остаются незакоммиченными и включаются в снимок; брать только git archive HEAD нельзя.

Перед фактическим переключением повторить проверки и остановить изменения на время снимка. Если рабочее дерево содержит нужные правки, сохранить их копией/манифестом; ничего не удалять/reset/clean/stash автоматически.

## 2. Сохранить Alpha Legacy отдельно

Выбрать **новую** папку вне репозитория на защищённом диске, не в публичном Git:

```bash
backup_dir=/absolute/private/alpha-backup-NEW
mkdir -m 700 "$backup_dir"
git clone --mirror https://github.com/LunierVeil/Laterna-VTT.git "$backup_dir/alpha-remote.git"
git clone --mirror --no-hardlinks /absolute/path/Laterna-VTT "$backup_dir/alpha-local.git"
git ls-remote --refs https://github.com/LunierVeil/Laterna-VTT.git > "$backup_dir/remote-refs.tsv"
git --git-dir="$backup_dir/alpha-remote.git" fsck --full
git --git-dir="$backup_dir/alpha-local.git" fsck --full
git --git-dir="$backup_dir/alpha-remote.git" show-ref > "$backup_dir/remote-mirror-refs.tsv"
git --git-dir="$backup_dir/alpha-local.git" show-ref > "$backup_dir/local-mirror-refs.tsv"
git --git-dir="$backup_dir/alpha-remote.git" bundle create "$backup_dir/alpha-remote.bundle" --all
git --git-dir="$backup_dir/alpha-remote.git" bundle verify "$backup_dir/alpha-remote.bundle"
git --git-dir="$backup_dir/alpha-local.git" bundle create "$backup_dir/alpha-local.bundle" --all
git --git-dir="$backup_dir/alpha-local.git" bundle verify "$backup_dir/alpha-local.bundle"
```

Сравнить пары ref -> object ID из ls-remote и for-each-ref (не только количество, не строки с peeled `^{}`). Отдельно проверить master HEAD, обе удалённые ветки, три тега и их peeled commit; локальный mirror также должен сохранить work и локальные refs. Дублирование refs origin/master допустимо. Remote mirror может содержать доступные refs/pull; это коммиты PR, но НЕ обсуждения/статусы PR. Проверка backup выполнена в текущем Cloud: подробности вне исходников, backups/verification.json.

Чтобы прочитать старую версию из backup без изменения исходного проекта:

```bash
git clone /private/alpha-backup-NEW/alpha-remote.git /private/legacy-readback-NEW
git -C /private/legacy-readback-NEW show v0.1.2-alpha:README.md
```

Git fsck может сообщать dangling objects локальной истории; без ошибок отсутствующих/повреждённых объектов это не потеря доступных refs. Не выполнять gc/prune backup и не mirror-push его в новый проект. Сделать вторую копию backup/manifest/checksums на независимый диск: Cloud workspace не является долговременным хранилищем.

## 3. GitHub-объекты: отдельный экспорт

Git mirror/bundle НЕ сохраняет Issues, PR/reviews/comments/events, release descriptions/binary assets, настройки Actions, branch protection/rulesets, hooks, environments, permissions/collaborators, stars/forks, Discussions, Wiki и вложения комментариев. Rename самого GitHub repo сохраняет историю и обычные GitHub-объекты; backup нужен на случай ошибки, а не для реконструкции через удаление.

Подготовлен read-only `scripts/export-github.py`. У владельца с подходящими правами:

```bash
gh auth status
python3 scripts/export-github.py LunierVeil/Laterna-VTT /private/github-alpha-export-NEW
```

Он сохраняет JSON репозитория, все страницы Issues/PR, комментарии/события/reviews/commits/files, релизы с описаниями и бинарными asset по ID (проверка размера), workflows, hooks, rulesets/details, environments и protected-branch settings. `COMPLETE.json` создаётся только после успеха всех запрошенных endpoint/download и содержит SHA-256. При ошибке partial-папка не считается backup, повторять в новой папке. JSON и assets не являются автоматически импортируемой копией всех настроек/идентификаторов GitHub.

В этом Cloud API ответил **Forbidden**, поэтому экспорт метаданных и опубликованных release assets НЕ выполнен. Число опубликованных Releases не установлено; три Git-тега не доказывают три GitHub Releases. Владелец дополнительно сохраняет:

- вложения Issues/PR/Discussions (URL в JSON, вручную скачать с авторизацией и сверить), Wiki отдельным clone, если включена, и Discussions экспортом/UI;
- collaborators/teams, repository settings, deploy keys (публичные части), Actions variables/cache policy и workflow run logs/artifacts с истекающим retention;
- secret values отдельно из своего защищённого хранилища: GitHub API их не раскрывает, exporter не восстанавливает их; webhook secrets также требуют повторной настройки;
- Git LFS объекты, если появятся: `git lfs fetch --all` в отдельной backup-копии. В текущих исходниках LFS не используется.

Не публиковать экспорт, старую историю или backup данных без отдельного аудита: старая история намеренно не переписывается и может содержать персональные сведения.

## 4. Игровые данные - не исходники

Cloud не имеет доступа к локальному игровому компьютеру. Подготовка Git backup **не означает**, что сохранены реальные кампании. Перед переносом остановить стол и туннель, закрыть окна launcher. На локальной машине создать новую private backup-папку вне repo.

SQLite/Linux (заменить пути, выполнить при остановленном приложении):

```bash
install_dir=/absolute/path/Laterna-VTT
backup_dir=/absolute/private/game-backup-NEW
mkdir -m 700 "$backup_dir"
python3 - "$install_dir/server/lanterna.db" "$backup_dir/lanterna.db" <<'PY'
import sqlite3, sys
from pathlib import Path
source, target = map(Path, sys.argv[1:])
assert source.is_file() and not target.exists()
with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as src:
    with sqlite3.connect(target) as dst:
        src.backup(dst)
        assert dst.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
PY
cp -a "$install_dir/server/uploads" "$backup_dir/"   # если существует
cp -a "$install_dir/server/gm_key.txt" "$backup_dir/" # если используется файл ключа
# Также сохранить локальные .env/служебные настройки/секреты вне Git, если они есть.
```

Если DATABASE_URL/UPLOAD_DIR/GM_KEY_FILE переопределены, использовать реальные настроенные пути, не дефолтные. PostgreSQL: у владельца с настроенными pg_service.conf/.pgpass выполнить `pg_dump --format=custom --file=/private/game-backup-NEW/laterna.dump --dbname='service=laterna'`, сохранить uploads/ключ/конфигурацию отдельно. Проверить `pg_restore --list /private/game-backup-NEW/laterna.dump`; пробное восстановление - только в отдельную тестовую БД по отдельному разрешению, не поверх пользовательской. Пароль не включать в команду/логи/Git.

Windows ZIP: после остановки стола пункт 4 меню сохраняет lanterna.db/uploads/gm_key.txt; скопировать получившуюся backup-папку на отдельный диск и отдельно сохранить свои настройки. Не считать одну папку рядом с установкой независимой резервной копией. WAL/SHM и файлы живой SQLite не копировать произвольно: остановка приложения и SQLite backup API предпочтительнее.

## 5. Подготовить снимок без старой .git

```bash
python3 scripts/prepare-repository.py /absolute/path/Laterna-VTT /private/Laterna-VTT-clean-NEW
```

Скрипт включает Git-visible tracked и новые nonignored файлы **из рабочего дерева**, поэтому не теряет незакоммиченные правки и учитывает удаления. Исключённые локальные файлы не читаются и не удаляются. Запрещённые tracked пути (DB, uploads, env, credentials, build/dependency directories) останавливают копирование до создания снимка. Symlink и неожиданный binary требуют ручного review. Нет init/commit/push и перезаписи существующей папки.

Рядом создаётся `.manifest.json`: base HEAD, status, пути, режимы и SHA-256 всех скопированных файлов. Манифест и backup остаются вне нового репозитория. Сверить все hashes/режимы, список необходимых файлов, наличие LICENSE, скриптов запуска, всех тестов, requirements/package-lock/workflows/docs. В источнике не должно идти параллельное редактирование во время копирования.

Сканирование путей и известных token/private-key signatures не доказывает отсутствие произвольного секрета. Дополнительно выполнить `gitleaks dir /private/Laterna-VTT-clean-NEW --redact --report-format json --report-path /private/gitleaks-report.json`, просмотреть список файлов/дифф и `.env.example`. Никогда не подавлять реальную утечку ради зелёного отчёта. `.gitignore` не очищает уже отслеживаемые файлы - это отдельно проверяет snapshot script.

## 6. Переключение GitHub - только после подтверждения

Предусловия: тесты актуального снимка пройдены, локальные игровые данные проверенно сохранены владельцем, mirrors и GitHub-export перенесены на независимый носитель. Затем владелец:

1. Settings -> General исходного repo -> Rename: **Laterna-VTT-Alpha-Legacy**. Не удалять/не архивировать автоматически. Проверить обе ветки, все теги, Releases/описания/вложения и старые commit URLs после rename.
2. Создать **новый пустой** LunierVeil/Laterna-VTT, без auto README/license/.gitignore. Публичность - отдельное согласованное действие. Старые fork/issue IDs/release IDs остаются в Legacy, автоматически не переезжают.
3. В отдельной clean-папке, НЕ в исходном рабочем repo, выполнить команды следующего раздела. Обновить remotes старых локальных копий на Legacy только после проверки: `git remote set-url origin https://github.com/LunierVeil/Laterna-VTT-Alpha-Legacy.git`.

Ссылка Legacy до rename зарезервирована и может не открываться. После создания нового repo прежние GitHub redirects могут перестать вести на Legacy, поэтому использовать явный новый Legacy URL.

## 7. Один начальный коммит: только после подтверждения

Команды ниже - индивидуальная настройка рабочего окружения, не общие скрипты проекта:

```bash
cd /private/Laterna-VTT-clean-NEW
# Здесь .git отсутствует; старый repo не трогать.
git init --initial-branch=master
git config --local user.name 'LunierVeil'
git config --local user.email 'egorka.bespalov.03@mail.ru'
git config --local core.autocrlf false
# Убрать унаследованные переопределения идентичности, затем проверить эффективные значения.
unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_AUTHOR_DATE GIT_COMMITTER_DATE
git config --show-origin --get user.name
git config --show-origin --get user.email
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
git add .
git diff --cached --check
git diff --cached --stat
git ls-files -ci --exclude-standard # должно быть пусто
# Только теперь, при корректных identity и аудите:
git commit -m 'Initial commit: Laterna VTT Alpha'
git rev-list --count HEAD          # ровно 1
git rev-list --max-parents=0 HEAD   # ровно текущий HEAD
git log -1 --format='%h | Author: %an <%ae> | Committer: %cn <%ce>'
git tag --list                     # пусто
git remote add origin https://github.com/LunierVeil/Laterna-VTT.git
git push -u origin master          # без force, --mirror и --tags
```

Ожидаются только LunierVeil / egorka.bespalov.03@mail.ru; при любой другой identity остановиться. В PowerShell убрать соответствующие переменные через `Remove-Item Env:GIT_AUTHOR_NAME,... -ErrorAction SilentlyContinue`, затем выполнить те же git config/var проверки. Персональные git config не добавлять в dev.sh/laterna.sh/CI или общие setup-скрипты. Исторических авторов Legacy не изменять.

## 8. Actions и защита master - после bootstrap

После первого push в Settings -> Actions разрешить GitHub Actions/стандартные checkout/setup/upload actions. Для workflow token выбрать read-only по умолчанию; право contents:write уже ограничено publish job. Не добавлять личный PAT или реальные ключи приложения ради CI. Дождаться первого CI required, сохранить ссылку на run.

Затем Settings -> Branches -> Add branch protection rule master (или эквивалентный ruleset): require PR, required checks `CI required`, require up-to-date branch, no force-push, no deletion, применить к администраторам. Не включать обязательное чужое approval для единственного автора. Готовый пример запроса: docs/master-protection.json. Только после разрешения и первого успешного run у владельца:

```bash
gh api --method PUT repos/LunierVeil/Laterna-VTT/branches/master/protection --input docs/master-protection.json
```

Если план/права не позволяют, не обходить: настроить доступные UI-правила и явно оставить недоступную защиту неисполненной. До первого push защиты не применять. Отдельно настроить environment `release`/reviewers и ограничения на изменение релизных v* tags, чтобы уже выпущенные tags не перемещались.

Проверка CI/CD: открыть обычный тестовый PR, увидеть backend/frontend/browser/CI required; проверить на временном PR, что намеренно падающая проверка блокирует merge, затем исправить через новый commit (не ослаблять проверки). Запустить Windows release вручную с publish=false и точным SHA, скачать проверенный ZIP. Убедиться, что обычный push master не создаёт release. Удалённые пробные PR/commits/workflow runs выполняются только после отдельного согласования; в текущей подготовке не создавались.

## 9. Откат

До rename: остановить подготовку; исходный repo, история и локальные данные не менялись. Новые папки можно оставить для review, ничего не удалять автоматически.

После rename, до создания нового repo: владелец по отдельному решению может переименовать Legacy обратно и проверить remotes. После появления нового repo исходное имя занято: не удалять новый проект ради отката; согласовать временный rename нового, затем вернуть имя старому. Автоматического rollback через force-push/перемещение тегов/перезапись истории нет.

Локальная установка не переключается вместе с GitHub. Старая папка и backup остаются; новые бинарники проверяются отдельно. При уже выполненных миграциях вернуть старое приложение можно только вместе с совместимой копией данных после согласования; не запускать старый код на изменённой пользовательской БД вслепую. Mirrors/bundles позволяют читать старую историю, но не возвращают GitHub-обсуждения или release assets без отдельного экспорта.


## Новая структура до Initial Commit

Alpha Legacy уже находится в LunierVeil/Laterna-VTT-Alpha-Legacy; подготовка инфраструктуры сохранена там в chore/beta-migration-prep (34b81d2). Ранние разделы выше сохраняют историческую последовательность подготовки, а не разрешение повторить rename. Для нового root использовать очищенный snapshot: архитектура/roadmap/references/bugs/checklist в docs/, инструкции Codex в AGENTS.md. CLAUDE.md отсутствует и игнорируется. Не создавать Initial Commit до отдельного разрешения.

Git-based prepare-repository.py используется только с корнем настоящего рабочего checkout. Для пересчёта готового snapshot без .git: `PYTHONDONTWRITEBYTECODE=1 python3 scripts/manifest-snapshot.py /path/to/source /private/source.manifest.json`. Manifest хранится вне исходников; количество файлов после реорганизации отличается от исторических 132.
