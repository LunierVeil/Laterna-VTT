# Book System v0.5 · Figma

**NEEDS REVIEW** — книжные интерфейсы готовы для визуального обсуждения. Источник витрины — три колонки из текстового задания владельца. Сам рисунок отсутствует в переданном вложении, поэтому детали компоновки реконструированы.

[Указатель](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-413) · [Интерактивная витрина](https://www.figma.com/proto/nBOZDRluDt2iXWMOK5OXhX/?page-id=38%3A2&node-id=92-436) · [Approved UI основной системы](https://www.figma.com/design/K3w1rS1t3ugjZQcpJGoHEY?node-id=638-2)

## Аудит v0.4

| Страница | Что перенесено или сохранено |
| --- | --- |
| [Components](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=35-2) | Разворот и читаемые состояния. BookShell и BookPage остаются основой. BookHeader, BookSearch, BookCategory, BookEntry, BookIllustration, BookActions и BookModeSwitch сохранены как мастера; содержание переопределено в инстансах. |
| [Concept v0.3](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=21-2) | Исторические альтернативы книги и списка, создания существа и главы NPC. |
| [Screens v0.4](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=38-2) | Пять новых обложек, развороты, витрина, быстрые переходы, два размера игрового стола и компактные страницы. Старые фреймы и инстансы сохранены. |
| [QA and behavior](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=43-2) | Длинные названия и описания, ошибки и переполнение. Добавлены ссылки на [пустой поиск, загрузку и другие состояния](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4122). |
| [Motion](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=66-2) | BookLauncher Closed, Collapsed и NewContent, исходный hover, разложение открытия и возврата, Reduced Motion. В v0.5 новый комплект обложек связан с показом раскрытия и перелистыванием; сохранён прямой статичный вход. [Исходный handoff](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=70-800). |

Токены бумаги, чернил, акцента и оболочки берутся из существующих Variables. На обложках главы различаются цветом и знаком. Общая оболочка разворота, IBM Plex Sans и Cormorant Garamond сохраняют узнаваемость. Для следующих вариантов потребуется общий параметр оформления обложки и библиотечный компонент предпросмотра; в этих макетах предпросмотр собран из самих разворотов. Список сохранён как плотный альтернативный режим. В макетах есть отдельные списки для книг и для двух ролей в Хрониках.

## Макеты

| Книга | Обложка | 1920×1080 | 1366×768 | Компактная страница |
| --- | --- | --- | --- | --- |
| NPC | [Обложка](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-482) | [Разворот](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-644) | [1366](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4272) | [520](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4343) |
| Книга чудовищ | [Обложка](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-492) | [Разворот](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-734) | [1366](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4382) | [520](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4453) |
| Homebrew | [Обложка](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-502) | [Разворот](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-824) | [1366](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4492) | [520](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4563) |
| Заклинания | [Обложка](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-512) | [Разворот](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-914) | [1366](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4602) | [520](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4673) |
| Хроники | [Обложка](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-522) | [ГМ](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-1004) · [Игрок](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-532) | [1366](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4712) | [520](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4783) |

- Витрина — [обложки](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-436), [раскрытые страницы](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4168), [перелистывание](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4822). Кнопки открытия доступны сразу. Последняя книга и поиск показаны на заданных демонстрационных переходах.
- [Список чудовищ](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-563) · [Форма Homebrew](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=92-595) · [Пустая книга](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4160) · [Homebrew-заклинание](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=96-2463).
- Персонажи — [интерактивное меню](https://www.figma.com/proto/nBOZDRluDt2iXWMOK5OXhX/?page-id=38%3A2&node-id=94-4029), [импорт LSS](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4044), [добавление спутника](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4067), [назначение управляющего](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=94-4101). Импорт в Figma показывает UX выбора файла. Предусмотрен [пример проверки файла и выбора раскладки](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=99-2070). Рабочий парсер и добавление героя остаются в существующем прототипе.

- Формы NPC — [создание](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=99-2023), [редактирование](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=99-2037), [размещение](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=99-2051).
- Действия в книгах — [выбор листа для заклинания](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=99-2060), [предпросмотр публикации игрокам](https://www.figma.com/design/nBOZDRluDt2iXWMOK5OXhX?node-id=99-2088).

### Кадры Figma

[Витрина](review/book-showcase.png) · [Примеры разворотов](review/book-open-previews.png) · [Гримуар](review/book-srd-grimoire.png) · [Импорт LSS](review/book-lss-preview.png).

## Контракты после отдельного согласования

1. Оболочка, обложка, раскладка разворота, состояния поиска, список и витрина переносятся как UI над существующими моделями. 1366 и 520 — основания для проверки реальной прокрутки, длинных строк и клавиатуры.
2. NPC и чудовища сохраняют тип и идентификатор шаблона. Homebrew — происхождение и второе представление той же пользовательской записи. Для копии SRD нужны собственный идентификатор и происхождение; размещённый токен сохраняет свои HP. Подтвердить контракты хранения исходника, прав и повторного размещения до реализации.
3. Спутник выбирается из подходящей книги либо создаётся в форме. В прототипе есть `companion.controllerId`. Для production отдельно проверить права назначения, редактирования и видимости по авторитетному контексту кампании. Отдельную книгу спутников имеет смысл рассматривать только после проверки текущего сценария.
4. Книга заклинаний использует проверенный каталог, видимый круг и допустимый лист. Пользовательские заклинания хранятся отдельно от пользовательских существ. Хроники используют существующие права доступа к материалам, включая выдачу раздаток и фильтрацию на стороне сервера.
5. Закрепление успешной раскладки после создания и LSS должно сохранять действующий импорт. Motion реализуется поверх проверенной навигации с явным статичным путём. Дизайн Figma ожидает согласования, React-перенос книжной части отложен.

Для примеров SRD 5.1 сохраняется атрибуция Wizards of the Coast LLC, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Собственные имена, хроники и зарисовки служат демонстрационным контентом.

## Вопросы для владельца

- На малом окне предпочтительнее одна страница с переходом к оглавлению или постоянный компактный список рядом.
- Для спутника рекомендуемый путь — тот же шаблон и отдельное назначение управляющего. Стоит проверить, достаточно ли этого сценария из вкладки «Персонажи».
- Стоит проверить, насколько полезна команда «Последняя открытая книга» рядом с прямым поиском и созданием с нуля.
