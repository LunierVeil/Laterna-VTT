import type { SheetSchema } from "./schema";

/**
 * Лист D&D 5e. Только поля: никаких классов, расчётов и проверок правил.
 * Игрок вписывает числа сам, как в бумажном листе или в Roll20.
 *
 * min/max - не правила, а защита от опечаток, с запасом под хоумбрю.
 * Тесно - поправь здесь.
 */
export const dnd5e: SheetSchema = {
  id: "dnd5e",
  title: "D&D 5e",
  blocks: [
    {
      kind: "fields",
      title: "Основное",
      fields: [
        { key: "info.class", label: "Класс", kind: "text" },
        { key: "info.subclass", label: "Подкласс", kind: "text" },
        { key: "info.level", label: "Уровень", kind: "number", width: 4, min: 1, max: 20 },
        { key: "info.race", label: "Раса / вид", kind: "text" },
        { key: "info.background", label: "Предыстория", kind: "text" },
        { key: "info.alignment", label: "Мировоззрение", kind: "text" },
        { key: "info.xp", label: "Опыт", kind: "number", width: 6, min: 0, max: 1000000 },
      ],
    },
    {
      kind: "fields",
      title: "Бой",
      fields: [
        { key: "vitals.hp.current", label: "Хиты", kind: "number", width: 4, min: -999, max: 9999 },
        { key: "vitals.hp.max", label: "Макс. хиты", kind: "number", width: 4, min: 1, max: 9999 },
        { key: "vitals.hp.temp", label: "Временные", kind: "number", width: 4, min: 0, max: 9999 },
        { key: "vitals.ac", label: "КД", kind: "number", width: 4, min: 0, max: 40 },
        { key: "vitals.speed", label: "Скорость", kind: "text", width: 6 },
        { key: "vitals.initiative", label: "Инициатива", kind: "number", width: 4, min: -10, max: 30 },
        { key: "vitals.hit_dice", label: "Кости хитов", kind: "text", width: 6 },
        { key: "proficiency", label: "Бонус мастерства", kind: "number", width: 4, min: 0, max: 10 },
      ],
    },
    {
      kind: "abilities",
      title: "Характеристики",
      path: "abilities",
      // 30 - потолок характеристики по самим правилам 5e.
      min: 1,
      max: 30,
      items: [
        { key: "str", label: "Сила" },
        { key: "dex", label: "Ловкость" },
        { key: "con", label: "Телосложение" },
        { key: "int", label: "Интеллект" },
        { key: "wis", label: "Мудрость" },
        { key: "cha", label: "Харизма" },
      ],
    },
    {
      kind: "checklist",
      title: "Навыки",
      path: "skills",
      fields: [
        { key: "prof", label: "влад.", kind: "checkbox" },
        { key: "bonus", label: "бонус", kind: "number", width: 3, min: -10, max: 30 },
      ],
      items: [
        { key: "acrobatics", label: "Акробатика", hint: "Лов" },
        { key: "animal_handling", label: "Уход за животными", hint: "Мдр" },
        { key: "arcana", label: "Магия", hint: "Инт" },
        { key: "athletics", label: "Атлетика", hint: "Сил" },
        { key: "deception", label: "Обман", hint: "Хар" },
        { key: "history", label: "История", hint: "Инт" },
        { key: "insight", label: "Проницательность", hint: "Мдр" },
        { key: "intimidation", label: "Запугивание", hint: "Хар" },
        { key: "investigation", label: "Анализ", hint: "Инт" },
        { key: "medicine", label: "Медицина", hint: "Мдр" },
        { key: "nature", label: "Природа", hint: "Инт" },
        { key: "perception", label: "Внимательность", hint: "Мдр" },
        { key: "performance", label: "Выступление", hint: "Хар" },
        { key: "persuasion", label: "Убеждение", hint: "Хар" },
        { key: "religion", label: "Религия", hint: "Инт" },
        { key: "sleight_of_hand", label: "Ловкость рук", hint: "Лов" },
        { key: "stealth", label: "Скрытность", hint: "Лов" },
        { key: "survival", label: "Выживание", hint: "Мдр" },
      ],
    },
    {
      kind: "table",
      title: "Оружие",
      path: "weapons",
      addLabel: "Добавить оружие",
      columns: [
        { key: "name", label: "Название", kind: "text" },
        { key: "attack", label: "Атака", kind: "text", width: 5 },
        { key: "damage", label: "Урон", kind: "text", width: 8 },
        { key: "type", label: "Тип", kind: "text", width: 8 },
      ],
    },
    {
      kind: "table",
      title: "Ресурсы",
      path: "resources",
      addLabel: "Добавить ресурс",
      columns: [
        { key: "name", label: "Название", kind: "text" },
        { key: "current", label: "Есть", kind: "number", width: 3, min: 0, max: 999 },
        { key: "max", label: "Макс.", kind: "number", width: 3, min: 0, max: 999 },
        {
          key: "rest",
          label: "Отдых",
          kind: "select",
          options: [
            { value: "", label: "-" },
            { value: "short", label: "короткий" },
            { value: "long", label: "долгий" },
          ],
        },
      ],
    },
    {
      kind: "table",
      title: "Заклинания",
      path: "spells",
      addLabel: "Добавить заклинание",
      columns: [
        { key: "name", label: "Название", kind: "text" },
        { key: "level", label: "Круг", kind: "number", width: 3, min: 0, max: 9 },
        { key: "link", label: "Ссылка (https)", kind: "link" },
        { key: "notes", label: "Заметка", kind: "text" },
      ],
    },
    {
      kind: "table",
      title: "Снаряжение",
      path: "equipment",
      addLabel: "Добавить предмет",
      columns: [
        { key: "name", label: "Название", kind: "text" },
        { key: "qty", label: "Кол-во", kind: "number", width: 3, min: 0, max: 99999 },
        { key: "link", label: "Ссылка (https)", kind: "link" },
        { key: "notes", label: "Заметка", kind: "text" },
      ],
    },
    {
      kind: "fields",
      title: "Монеты",
      fields: [
        { key: "coins.cp", label: "ММ", kind: "number", width: 5, min: 0, max: 9999999 },
        { key: "coins.sp", label: "СМ", kind: "number", width: 5, min: 0, max: 9999999 },
        { key: "coins.ep", label: "ЭМ", kind: "number", width: 5, min: 0, max: 9999999 },
        { key: "coins.gp", label: "ЗМ", kind: "number", width: 5, min: 0, max: 9999999 },
        { key: "coins.pp", label: "ПМ", kind: "number", width: 5, min: 0, max: 9999999 },
      ],
    },
    {
      kind: "fields",
      title: "Заметки",
      fields: [{ key: "notes", label: "Заметки", kind: "longtext" }],
    },
    { kind: "texts", title: "Тексты из импорта", path: "texts", resourcesPath: "resources" },
  ],
};

export const SHEETS: Record<string, SheetSchema> = { dnd5e };
