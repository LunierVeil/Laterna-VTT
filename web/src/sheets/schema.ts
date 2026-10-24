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
}

export type Block =
  /** Обычные поля. */
  | { kind: "fields"; title: string; fields: Field[] }
  /**
   * Характеристики: data[path][key] = { score, save }. Модификатор
   * считается из значения - это арифметика, а не правило.
   */
  | { kind: "abilities"; title: string; path: string; items: { key: string; label: string }[] }
  /** Фиксированный список строк с одинаковыми полями: навыки. data[path][item.key][field.key]. */
  | {
      kind: "checklist";
      title: string;
      path: string;
      items: { key: string; label: string; hint?: string }[];
      fields: Field[];
    }
  /** Таблица, строки добавляет игрок: оружие, заклинания. data[path] = [{...}, ...]. */
  | { kind: "table"; title: string; path: string; columns: Field[]; addLabel: string };

export interface SheetSchema {
  id: string;
  title: string;
  blocks: Block[];
}
