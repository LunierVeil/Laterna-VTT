# Design System — Foundation и Components v0.3

<!-- DOCS-00 STATUS BEGIN -->
**AS-IS, DOCS-00 · 04.11.2026:** Foundation и Components v0.3 реализованы,
канонические компоненты и tokens находятся в shared/ui и shared/styles. FSD-09b
завершён; ограничения ранних этапов ниже — исторический контекст, не план нового
переноса. Редизайн Beta не выполнен. Ограничение визуальной сверки Figma ниже
сохраняется; недоступные frames не объявляются проверенными.
[Текущие границы](FSD_SYSTEM_BOUNDARIES.md), [Beta-решения](BETA_DECISIONS.md).
<!-- DOCS-00 STATUS END -->

Первый этап — общие CSS-токены и нативные React/TypeScript-компоненты. Он сохраняет
внешний вид приложения и не реорганизует проект по FSD. Интеграция в игровой UI остаётся ограниченной двумя кнопками ConfirmDialog.
Components v0.3 расширяет библиотеку; новые компоненты демонстрируются в fixtures.

## Источники и соответствие Figma

Референс: [Figma UI Kit v0.2](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY).
В облачной среде Figma недоступна (HTTP 403), поэтому frame/node/style IDs не
проверены. Палитра и роли шрифтов взяты из спецификации задачи и сверены с текущим
CSS; они уже совпадали. Геометрия основана на существующих кнопках, полях и диалоге.
Точное соответствие отдельным фреймам Figma требует отдельной визуальной сверки.
Временные Figma URL, изображения и другие удалённые ресурсы в runtime не используются.
Шрифты по-прежнему поставляются локально пакетами @fontsource из lockfile.

## Архитектура

```text
web/src/shared/
  styles/tokens.css
  ui/Button/Button.tsx + Button.css
  ui/TextField/TextField.tsx + TextField.css
  ui/Checkbox/Checkbox.tsx + Checkbox.css
  ui/Panel/Panel.tsx + Panel.css
```

В приложении `styles.css` импортирует tokens.css один раз. Каждый компонент
импортирует собственный CSS с префиксом ds-. При использовании компонентов вне
приложения также подключайте tokens.css на уровне корня. Общие компоненты не
импортируют Zustand, сеть, игровые типы, PixiJS или бизнес-логику. Общего barrel
пока нет: прямые импорты делают зависимости первого этапа явными.

## Токены

`tokens.css` — единственный источник определений базовых CSS-переменных UI.
Старые имена сохранены; новые семантические имена ссылаются на них через var(),
а не содержат вторую копию палитры. Не переопределяйте значения в компонентах.

| Роль | Совместимое имя | Семантическое имя | Значение |
| --- | --- | --- | --- |
| Фон | --bg | --color-background | #121318 |
| Панель | --panel | --color-panel | #17181E |
| Поверхность | --surface | --color-surface | #1F2129 |
| Hover поверхности | --surface-hover | --color-surface-hover | #22242C |
| Рамка | --line | --color-border | #2C2F3A |
| Текст | --text | --color-text | #E9E6DF |
| Приглушённый текст | --muted | --color-muted | #A9A6A0 |
| Акцент | --accent | --color-accent | #F0B14A |
| Фон акцента | --accent-bg | --accent-bg | #2B2416 |
| На акценте | --on-accent | --on-accent | #1A1408 |
| Успех | --ok | --color-success | #6CC070 |
| Опасность | --danger | --color-danger | #C75C5C |

Дополнительные существующие оттенки --line-soft, --line-hover, --text-2,
--accent-text сохранены. --color-on-danger сохраняет белый текст опасной кнопки.
--sans = IBM Plex Sans (UI), --mono = IBM Plex Mono (числа/формулы/броски),
--serif = Cormorant Garamond (декоративные заголовки).

Семантические размеры извлечены из существующего CSS:

| Семейство | Значения и исходный контекст |
| --- | --- |
| control | gap 6px, min-height 40px, compact 34px, padding-inline 14px, radius 8px из .btn/.icon-btn |
| field | padding 7px 10px, radius 6px из input; label-gap 8px из .gate-field |
| panel | padding 12px, radius 12px, gap 8px из существующих поверхностей |
| dialog | padding 18px 20px из .dialog |
| focus-ring | width 2px, offset 2px, цвет --accent из существующего focus-visible |

Новой числовой шкалы spacing нет. Layout-токен --sidebar сохранён. Узкие
контекстные цвета, начальная HTML-заглушка до загрузки CSS и цвета SceneStage
не мигрировали: это не массовая замена всех литералов и не тема PixiJS.

## Соответствие существующих классов

| Существующий паттерн | Foundation | Граница первого этапа |
| --- | --- | --- |
| .btn, .btn-accent, .btn-danger | Button secondary/primary/danger | Внедрено в ConfirmDialog |
| .icon-btn, .gate-link | Button ghost | Не заменяет автоматически размеры/иконки старых кнопок |
| input, .gate-field, .gate-error | TextField | Login остаётся на прежней разметке |
| label + input[type=checkbox] | Checkbox | Игровые чек-листы не переписываются |
| .token-card, .dialog, .card, .gate-panel | Panel | Не заменяет специализированные layout и семантику диалога |
| .side-tab/.side-tab-on, .sheet-tab/.sheet-tab-on | Tabs | Sidebar и игровые листы не мигрируют; см. Components v0.3 |
| .status-on/.status-off, .btn-on, :disabled | Семантические цвета и состояния | Нового компонента Status/Toggle пока нет |

## Компоненты

```tsx
import { Button } from "./shared/ui/Button/Button";
import { TextField } from "./shared/ui/TextField/TextField";
import { Checkbox } from "./shared/ui/Checkbox/Checkbox";
import { Panel } from "./shared/ui/Panel/Panel";

<Panel role="region" aria-label="Настройки">
  <TextField label="Имя" name="name" placeholder="Введите имя" />
  <Checkbox label="Показывать сетку" checked={showGrid}
    onChange={event => setShowGrid(event.target.checked)} />
  <Button variant="primary" type="submit">Сохранить</Button>
</Panel>
```

Button — настоящий button с default type=button: случайное помещение в form не
отправит форму. Для отправки явно задайте type=submit. Варианты: secondary
(по умолчанию), primary, ghost, danger. Поддерживаются нативные атрибуты,
aria-*, data-*, onClick, className и forwardRef<HTMLButtonElement>. Hover меняет
рамку, ghost — ещё поверхность, danger сохраняет прежнее осветление; active
имеет отдельное затемнение, focus-visible — существующее кольцо. Disabled —
нативный disabled, без кликов и keyboard activation, пропускается Tab; opacity
и cursor отражают состояние. aria-disabled не заменяет disabled.

TextField связывает label с input через переданный id или React useId. error
добавляет aria-invalid и связанный текст с role=alert, сохраняя переданный
aria-describedby. Нативные type/name/placeholder/required/disabled/value/onChange
и input ref передаются без изменения. className относится к input. Если visible
label опущен, задайте доступное имя через aria-label или aria-labelledby.

Checkbox — нативный input type=checkbox внутри связанного label. label — текст
или ReactNode; checked/onChange для controlled, defaultChecked для uncontrolled.
Не смешивайте режимы и не меняйте их в течение жизни компонента. Space, клик по
подписи и disabled работают средствами браузера; ref/className относятся к input.
Нативный размер и appearance сохраняются, кастомный checkbox не рисуется.

Panel — div с базовой поверхностью, рамкой, radius, padding/gap. Поддерживает
children, className, ref и обычные div-атрибуты. Семантику (role/aria-label) задаёт
вызывающий код; Panel не превращается автоматически в dialog или region.

## Безопасность существующего ConfirmDialog

Сохранены role=alertdialog, aria-modal, название и подписи кнопок. Начальный фокус
через ref остаётся на «Отмена»: Enter сразу после открытия отменяет действие.
Escape и клик по overlay отменяют, клик внутри не отменяет. Подтверждение происходит
только после явной активации кнопки подтверждения. Это не новый универсальный modal:
focus trap, восстановление фокуса и редизайн ConfirmDialog не добавлены в Foundation.

## Расширение и ограничения

Сначала используйте существующую семантическую роль токена. Новое значение
добавляйте в tokens.css только с конкретным UI-контекстом и основанием из макета
или существующего CSS. Не меняйте legacy-алиасы и состояния массово без проверки
существующих экранов. Новые варианты требуют keyboard/disabled/error тестов и
визуальной сверки. Не добавляйте библиотеки ради простых нативных элементов.

Полная FSD-миграция, рефакторинг Zustand, Book System, сетевой протокол, backend,
игровые функции и цвета/рендер SceneStage не затронуты. Все остальные экраны
сохраняют свою разметку; Login изучен, но не переведён на новые компоненты.

## Проверки

Из web: `npm test`, `npm run typecheck`, `npm run build`,
`CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- --suite design-system`.
Полный прогон: `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`.

Unit-тесты рендерят реальные TSX-компоненты через ReactDOMServer; test-only loader
транспилирует JSX установленным TypeScript и игнорирует CSS только в Node.
Chromium проверяет реальные CSS, клавиатуру, ref, формы, disabled и error-связи.
HTML/TSX fixture лежит только в tests/browser/fixtures, не включается в production
entrypoint и не обращается к пользовательским игровым данным.

До внедрения сняты четыре baseline скриншота реального ConfirmDialog: desktop
1280x900 и mobile 390x844, primary/danger. В той же локальной версии Chromium
после внедрения получено побайтовое совпадение пикселей и совпадение computed
styles (цвета, шрифты, размеры, padding, border, focus ring). Результаты —
`artifacts/design-system/before-*.png`, `after-*.png`, `before.json`, `after.json`.
Эти артефакты не коммитятся. CI сохраняет актуальные screenshots новой suite;
межплатформенное побайтовое сравнение с локальным baseline не навязывается.

Browser suite design-system добавлена в группу interaction. Ожидаемые количества
в evidence/gate обновлены на 14 для interaction с Components v0.3, итого 35 browser-проверок. Gate
по-прежнему отклоняет неполные/failed/skipped прогоны. Full CI merge-коммита должен
быть проверен через PR после разрешённых commit/push; локальные проверки его не заменяют.


## Components v0.3

Актуальные источники дизайна:

- [UI Components Overview](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=34-2)
- [Master Components](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=28-2)
- [React Integration Specification](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=36-2)
- [Shared UI States](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=34-233)

Figma v0.3 также отвечает HTTP 403 из облачной среды. Исправленные дизайнером
Tabs/Dialog/Tooltip не удалось визуально сверить. Реализация следует текстовому
контракту задачи и существующей палитре, размерам/шрифтам Foundation. Не подтверждены
точные отступы, тени, формы и геометрия состояний из последних макетов. Runtime не
использует Figma URL. Перед визуальным утверждением нужна сверка этих screenshots
с доступной дизайнеру версией макетов; локальные проверки не заменяют дизайн-QA.

Структура дополняется четырьмя папками, каждая содержит одноимённые TSX и CSS:

```text
web/src/shared/ui/
  Tabs/Tabs.tsx + Tabs.css
  Dialog/Dialog.tsx + Dialog.css
  Tooltip/Tooltip.tsx + Tooltip.css
  Select/Select.tsx + Select.css
```

Каждый CSS использует префикс `ds-` и существующие tokens.css. Палитра и legacy
классы не изменены, новых зависимостей нет. Прямые импорты — как в Foundation.
Компоненты не получают игровые типы и не знают о правах ГМ, WebSocket или store.
Игровые AttackRollCard, NPCCard, InitiativeTracker остаются вне shared/ui.
Book System v0.4 и замена временной иконки BookLauncher — отдельные задачи.

### Tabs

```tsx
<Tabs value={tab} onValueChange={setTab} size="compact" aria-label="Панели"
  items={[
    { value: "chat", label: "Чат", content: <ChatDraft /> },
    { value: "characters", label: "Персонажи", content: <Characters /> },
    { value: "scenes", label: "Сцены", content: <Scenes />, hidden: !isGm },
    { value: "players", label: "Игроки", content: <Players />, disabled: !canManage },
  ]} />
```

API: `value: string`, `items: readonly TabItem[]`, `onValueChange(value)`,
`size?: regular | compact`, `disabled?: boolean`, `aria-label?: string`.
Каждый item: уникальное стабильное `value`, `label`, `content`, необязательные
`disabled` и `hidden`. Родитель определяет доступность по правам и обязан
авторизовать данные отдельно: hidden — средство UI, не граница безопасности.
Hidden item вообще не рендерится; inactive panel остаётся смонтированной с hidden.
Черновики/локальное состояние сохраняются при смене вкладки, но не при удалении
item или размонтировании всего Tabs. Не меняйте ключи/типы панелей при переключении.
Если текущий item удалён/недоступен, визуально выбирается первый доступный; родитель
может явно обновить controlled value. Компонент не вызывает callback при render.
Общий disabled запрещает действия, сохраняя активную панель.

Роли tablist/tab/tabpanel, уникальные aria-controls/labelledby, aria-selected,
один tabIndex=0 среди доступных вкладок. ArrowLeft/Right циклически переключают
вкладку и фокус, Home/End выбирают первую/последнюю, disabled пропускаются.
Модель активации автоматическая; click и нативные Enter/Space также работают.
Для compact-контейнера берите существующий `--sidebar: 340px`. При 280px строка
прокручивается горизонтально, подписи не ужимаются; keyboard-переключение прокручивает
вкладку в видимую область. Это консервативное поведение по текстовому контракту;
его точное соответствие последнему Figma overflow-паттерну ещё не подтверждено.

### Dialog

```tsx
<Dialog open={open} kind="danger" title="Удалить запись?"
  description="Это действие нельзя отменить." confirmLabel="Удалить"
  pending={pending} onClose={() => setOpen(false)}
  onConfirm={async () => { await removeRecord(); setOpen(false); }} />
```

API: `open`, `kind?: confirmation | danger | information`, `title: string`,
`description?: ReactNode`, `confirmLabel`, `onConfirm(): void | Promise<void>`,
`onClose()`, `pending?: boolean`. По умолчанию kind=confirmation.
Компонент controlled: родитель закрывает его изменением open после успешной
операции или onClose. Во время Promise используется внутренний pending; внешний
pending предназначен для состояния вызывающего кода. Ошибка/rejected Promise
перехватывается и показывается в role=alert; после неё действие можно повторить.
Не подавляйте rejected Promise в вызывающем коде, если ждёте это сообщение.

Используется HTML dialog.showModal(), а не только aria-modal: фон inert,
диалог в top layer. confirmation/danger имеют role=alertdialog, information —
role=dialog; title/description связаны уникальными ARIA IDs. Focus trap удерживает
Tab/Shift+Tab внутри; фокус возвращается ранее активному подключённому элементу.
При confirmation/danger начальный фокус — «Отмена»: начальный Enter отменяет,
а не подтверждает опасное действие. При information только кнопка подтверждения.
Escape/backdrop и Cancel закрывают через onClose только вне pending. Во время
pending кнопки disabled, aria-busy и status сообщают состояние, синхронный ref-lock
блокирует двойное подтверждение до React render. Устаревшая завершившаяся операция
не переносит ошибку в заново открытый диалог. Description скроллится внутри,
кнопки остаются доступны при узком viewport; длинные слова переносятся.

Используйте один модальный Dialog одновременно. Description — текст/разметка
описания, не произвольная вложенная форма с собственной моделью фокуса.
Заголовок и подписи должны быть краткими; очень длинный контент помещайте в description.
Не перехватывайте Enter на внешнем контейнере для запуска onConfirm.

ConfirmDialog **не мигрирован** в этом PR. Старый публичный API, роли, фокус,
overlay, Escape и существующие проверки сохранены. Нативный modal добавляет
inert/top layer, focus trap и возврат фокуса; массовая замена существующего overlay
меняла бы поведение вложенных игровых окон. Это отдельная интеграционная задача
с проверкой каждого вызывающего места; для реализации библиотеки она не требуется.

### Tooltip

```tsx
<Tooltip content="Показать настройки" placement="top" delay={400}>
  <Button aria-label="Настройки">…</Button>
</Tooltip>
```

API: `content: ReactNode`, `placement?: top | bottom | left | right` (top),
`delay?: number` (400 мс), один `children: ReactElement`. Child должен быть
фокусируемым и передавать aria-describedby в DOM (Button это делает).
Не используйте фрагмент, нефокусируемый div или disabled button как единственный
доступный trigger. Уже имеющийся aria-describedby сохраняется.

Hover показывает tooltip после delay, keyboard focus — сразу. Escape закрывает
и предотвращает повторное открытие до завершения текущего hover/focus. Blur/mouseleave
закрывают при отсутствии другого активного источника. Tooltip имеет role=tooltip
и связанный id. Позиционирование fixed: при недостатке места переворачивает сторону,
затем ограничивает координаты viewport; пересчитывает при resize/scroll/изменении
размеров. Длинный текст переносится, ширина ограничена sidebar/viewport. Portal
использует ближайший dialog, если trigger внутри него, иначе body. Нет анимации;
reduced-motion явно отключает animation/transition. Содержимое — справочный текст,
без интерактивных элементов. Критические ошибки/инструкции должны быть видимы
отдельно; Tooltip не заменяет label и доступное имя trigger.

### Select

```tsx
<Select label="Режим" value={mode} onChange={event => setMode(event.target.value)}
  placeholder="Выберите режим" error={error} loading={loading} disabled={disabled}
  options={[{ value: "view", label: "Просмотр" }, { value: "edit", label: "Редактирование" }]} />
```

API: обычные select-атрибуты (`value`, `defaultValue`, native `onChange`, `name`,
`required`, `disabled`, `aria-*`, `ref<HTMLSelectElement>` и т.д.), плюс `label`,
`options: readonly {value: string; label: string; disabled?: boolean}[]`, `error`,
`loading`, `placeholder`. className относится к select. Placeholder — disabled
option с пустым value; задайте controlled value="" или defaultValue="", чтобы
показать его до выбора. Значения options уникальны; пустая строка резервируется
для placeholder. Не смешивайте controlled/uncontrolled режимы.

Нативные клавиатура, список и selected-состояние остаются браузерными/системными.
Label связан с select; error добавляет aria-invalid и role=alert к aria-describedby,
сохраняя внешнюю подсказку. Loading отключает select, добавляет aria-busy и видимый
status, не сбрасывает выбранное значение. После загрузки disabled по-прежнему
задаётся родителем. Без видимого label задайте aria-label/labelledby.
Figma Open — будущий custom combobox: оформление системного выпадающего окна
невозможно воспроизвести одинаково на всех ОС, собственного combobox здесь нет.

### Проверки v0.3 и screenshots

Fixture `tests/browser/fixtures/components-v03.html` показывает все компоненты;
не входит в production entrypoint. Unit покрывает ARIA/нативную разметку реальных
TSX; браузер — события, фокус, состояния и CSS. Новая suite `components-v03` добавляет
четыре теста в interaction: ожидается **14** вместо 10; полный прогон **35** вместо 31.
Строгость evidence/gate не ослаблена, предыдущие assertions/таймауты не изменены.

```bash
cd web
npm test
npm run typecheck
npm run build
CHROMIUM_PATH=/usr/bin/chromium BROWSER_RESULTS_DIR="$PWD/../artifacts/components-v03" npm run test:browser -- --suite components-v03
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

Скриншоты сохраняются suite в BROWSER_RESULTS_DIR: tabs regular/compact на 280/340,
dialog error/pending/длинный на 280, tooltip у края на 280, select states на 340. Регрессии также проверяют видимость
каждой keyboard-selected вкладки и повторное открытие Tooltip после Escape у
четырёх углов, в том числе когда указатель находился над исчезающим portal.
На текущем этапе новые компоненты не внедрены в production UI; старый ConfirmDialog
проверяется прежней Foundation suite. Full CI обязателен через PR после отдельно
разрешённых commit/push и должен соответствовать актуальному merge SHA.
