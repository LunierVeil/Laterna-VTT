/**
 * Описание листа персонажа. Схема - это данные: какие поля, где лежат,
 * как подписаны. Компоненты листа ничего не знают о системе правил и
 * рисуют то, что описано здесь. Новая система = новый файл схемы.
 *
 * Пути - через точку от корня data ("vitals.hp.current"). Так же они
 * уходят на сервер в character.update.
 */

export type FieldKind = "text" | "number" | "longtext" | "checkbox" | "link" | "select";

export interface Field {
  /** Путь внутри data. В таблицах и списках - внутри строки. */
  key: string;
  label: string;
  kind: FieldKind;
  /** Для select. */
  options?: { value: string; label: string }[];
  /** Ширина колонки или поля в символах, примерно. */
  width?: number;
  /**
   * Пределы для number - защита от опечатки (+99 вместо +9), а не правило
   * игры. Вне пределов форма не сохраняет. Числа в листе - только целые.
   */
  min?: number;
  max?: number;
}

export type Block =
  /** Обычные поля. */
  | { kind: "fields"; title: string; fields: Field[] }
  /**
   * Характеристики: data[path][key] = { score, save }. Модификатор
   * считается из значения - это арифметика, а не правило.
   */
  | {
      kind: "abilities";
      title: string;
      path: string;
      items: { key: string; label: string }[];
      /** Пределы значения характеристики. */
      min: number;
      max: number;
    }
  /** Фиксированный список строк с одинаковыми полями: навыки. data[path][item.key][field.key]. */
  | {
      kind: "checklist";
      title: string;
      path: string;
      items: { key: string; label: string; hint?: string }[];
      fields: Field[];
    }
  /** Таблица, строки добавляет игрок: оружие, заклинания. data[path] = [{...}, ...]. */
  | { kind: "table"; title: string; path: string; columns: Field[]; addLabel: string }
  /**
   * Карточки: умения, предметы, заклинания. data[path] = [{ id, [titleKey],
   * ...fields, doc }]. Описание (doc) - документ TipTap. Добавлять и править
   * можно и в режиме "игра": предмет нашли посреди сессии - не надо искать
   * кнопку "Редактировать". resourcesPath - откуда брать счётчики для
   * ссылок на ресурсы в описаниях.
   */
  | {
      kind: "cards";
      title: string;
      path: string;
      titleKey: string;
      fields: Field[];
      addLabel: string;
      resourcesPath: string;
    };

/**
 * Шапка листа - то, что нужно видеть всегда, на любой вкладке: хиты,
 * КД и подобное. Хиты - отдельно, у них кнопки −/+.
 */
export interface Summary {
  /** Пути, значения которых через пробел образуют подзаголовок: "Воин 5". */
  subtitle: string[];
  hp?: { current: string; max: string; temp?: string };
  /** Короткие значения рядом с хитами. */
  stats: Field[];
}

export interface Tab {
  id: string;
  title: string;
  blocks: Block[];
}

export interface SheetSchema {
  id: string;
  title: string;
  summary: Summary;
  /** Первая вкладка - та, что нужна в бою. */
  tabs: Tab[];
}
