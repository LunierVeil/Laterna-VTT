# Design System Foundation

Первый этап — общие CSS-токены и нативные React/TypeScript-компоненты. Он сохраняет
внешний вид приложения и не реорганизует проект по FSD. Единственная интеграция
в игровой UI сейчас — две кнопки ConfirmDialog.

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
| .side-tab/.side-tab-on, .sheet-tab/.sheet-tab-on | Будущий Tabs | Пока только аудит; сохраняются роли и поведение вкладок |
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

## Безопасность ConfirmDialog

Сохранены role=alertdialog, aria-modal, название и подписи кнопок. Начальный фокус
через ref остаётся на «Отмена»: Enter сразу после открытия отменяет действие.
Escape и клик по overlay отменяют, клик внутри не отменяет. Подтверждение происходит
только после явной активации кнопки подтверждения. Это не новый универсальный modal:
focus trap, восстановление фокуса и редизайн диалога не добавлены в этом этапе.

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
в evidence/gate обновлены на 10 для interaction, итого 31 browser-проверка. Gate
по-прежнему отклоняет неполные/failed/skipped прогоны. Full CI merge-коммита должен
быть проверен через PR после разрешённых commit/push; локальные проверки его не заменяют.
