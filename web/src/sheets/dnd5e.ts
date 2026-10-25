import type { CheckBonus, SheetSchema } from "./schema";
import { mob } from "./mob.ts";

const D20 = { normal: "1d20", advantage: "2d20kh1", disadvantage: "2d20kl1" };

const ABILITY_OPTIONS = [
  { value: "", label: "-" },
  { value: "str", label: "Сила" },
  { value: "dex", label: "Ловкость" },
  { value: "con", label: "Телосложение" },
  { value: "int", label: "Интеллект" },
  { value: "wis", label: "Мудрость" },
  { value: "cha", label: "Харизма" },
];

// Бонус = модификатор + мастерство при владении; "свой бонус" главнее.
// Это подсказка формы, не правило: экспертизу и предметы игрок вписывает сам.
const SKILL_BONUS: CheckBonus = {
  flag: "prof",
  manual: "bonus",
  abilities: "abilities",
  score: "score",
  proficiency: "proficiency",
};
const SAVE_BONUS: CheckBonus = { ...SKILL_BONUS, flag: "save", manual: "save_bonus" };

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
  portrait: "portrait",
  summary: {
    subtitle: ["info.class", "info.level"],
    hp: {
      current: "vitals.hp.current",
      max: "vitals.hp.max",
      temp: "vitals.hp.temp",
      // Вылечили с 0 - отметки спасбросков от смерти сбрасываются.
      resetOnHeal: ["death.successes", "death.fails", "death.dying"],
    },
    stats: [
      { key: "vitals.ac", label: "КД", kind: "number" },
      { key: "vitals.speed", label: "Скорость", kind: "text" },
      { key: "vitals.initiative", label: "Инициатива", kind: "number" },
      { key: "proficiency", label: "Мастерство", kind: "number" },
    ],
  },
  token: {
    bar: { current: "vitals.hp.current", max: "vitals.hp.max" },
    badge: { key: "vitals.ac", label: "КД" },
    speed: "vitals.speed",
    initiative: "vitals.initiative",
  },
  tabs: [
    {
      id: "main",
      title: "Главное",
      blocks: [
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
            { key: "vitals.hit_dice_current", label: "Осталось костей", kind: "number", width: 3, min: 0, max: 99 },
            { key: "inspiration", label: "Вдохновение", kind: "checkbox" },
            { key: "proficiency", label: "Бонус мастерства", kind: "number", width: 4, min: 0, max: 10 },
          ],
        },
        {
          kind: "deathSaves",
          title: "Спасброски от смерти",
          successes: "death.successes",
          fails: "death.fails",
          dying: "death.dying",
          max: 3,
          roll: { label: "спасбросок от смерти", formula: "1d20" },
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
            // Свойства и то, что не бросается (урон текстом без формулы из LSS).
            { key: "notes", label: "Заметки", kind: "text", width: 16 },
          ],
          rolls: {
            titleKey: "name",
            items: [
              {
                label: "атака",
                key: "attack",
                d20: D20,
                // Пустая "Атака" (LSS без mod) - бонус из ability и владения строки.
                computed: { ability: "ability", flag: "prof", abilities: "abilities", score: "score", proficiency: "proficiency" },
              },
              { label: "урон", key: "damage" },
            ],
          },
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
          counter: {
            titleKey: "name",
            current: "current",
            max: "max",
            rest: "rest",
            // Что возвращается после короткого отдыха, возвращается и после долгого.
            rests: [
              { label: "Короткий отдых", restores: ["short"] },
              { label: "Долгий отдых", restores: ["short", "long"] },
            ],
          },
        },
      ],
    },
    {
      id: "skills",
      title: "Навыки",
      blocks: [
        {
          kind: "checklist",
          title: "Спасброски",
          // Флаг владения - тот же abilities.<key>.save, что и в характеристиках.
          path: "abilities",
          fields: [
            { key: "save", label: "владение", kind: "prof" },
            { key: "save_bonus", label: "свой бонус", kind: "number", width: 3, min: -10, max: 30 },
          ],
          bonus: SAVE_BONUS,
          roll: { label: "спасбросок", d20: D20 },
          items: [
            { key: "str", label: "Сила", ability: "str" },
            { key: "dex", label: "Ловкость", ability: "dex" },
            { key: "con", label: "Телосложение", ability: "con" },
            { key: "int", label: "Интеллект", ability: "int" },
            { key: "wis", label: "Мудрость", ability: "wis" },
            { key: "cha", label: "Харизма", ability: "cha" },
          ],
        },
        {
          kind: "checklist",
          title: "Навыки",
          path: "skills",
          fields: [
            { key: "prof", label: "владение", kind: "prof" },
            { key: "bonus", label: "свой бонус", kind: "number", width: 3, min: -10, max: 30 },
          ],
          bonus: SKILL_BONUS,
          roll: { label: "навык", d20: D20 },
          items: [
            { key: "acrobatics", label: "Акробатика", hint: "Лов", ability: "dex" },
            { key: "animal_handling", label: "Уход за животными", hint: "Мдр", ability: "wis" },
            { key: "arcana", label: "Магия", hint: "Инт", ability: "int" },
            { key: "athletics", label: "Атлетика", hint: "Сил", ability: "str" },
            { key: "deception", label: "Обман", hint: "Хар", ability: "cha" },
            { key: "history", label: "История", hint: "Инт", ability: "int" },
            { key: "insight", label: "Проницательность", hint: "Мдр", ability: "wis" },
            { key: "intimidation", label: "Запугивание", hint: "Хар", ability: "cha" },
            { key: "investigation", label: "Анализ", hint: "Инт", ability: "int" },
            { key: "medicine", label: "Медицина", hint: "Мдр", ability: "wis" },
            { key: "nature", label: "Природа", hint: "Инт", ability: "int" },
            { key: "perception", label: "Внимательность", hint: "Мдр", ability: "wis" },
            { key: "performance", label: "Выступление", hint: "Хар", ability: "cha" },
            { key: "persuasion", label: "Убеждение", hint: "Хар", ability: "cha" },
            { key: "religion", label: "Религия", hint: "Инт", ability: "int" },
            { key: "sleight_of_hand", label: "Ловкость рук", hint: "Лов", ability: "dex" },
            { key: "stealth", label: "Скрытность", hint: "Лов", ability: "dex" },
            { key: "survival", label: "Выживание", hint: "Мдр", ability: "wis" },
          ],
        },
        {
          kind: "table",
          title: "Инструменты",
          path: "tools",
          addLabel: "Добавить инструмент",
          columns: [
            { key: "name", label: "Название", kind: "text" },
            { key: "ability", label: "Характеристика", kind: "select", options: ABILITY_OPTIONS },
            { key: "level", label: "Владение", kind: "prof" },
            // Пусто - подсказка "посчитано"; вписанное главнее.
            { key: "bonus", label: "Свой бонус", kind: "text", width: 4 },
          ],
          rolls: {
            titleKey: "name",
            items: [
              {
                label: "проверка",
                key: "bonus",
                d20: D20,
                computed: { ability: "ability", flag: "level", abilities: "abilities", score: "score", proficiency: "proficiency" },
              },
            ],
          },
        },
      ],
    },
    {
      id: "gear",
      title: "Снаряжение",
      blocks: [
        {
          kind: "cards",
          title: "Снаряжение",
          path: "equipment",
          titleKey: "name",
          addLabel: "+ Предмет",
          resourcesPath: "resources",
          fields: [
            { key: "qty", label: "Кол-во", kind: "number", width: 4, min: 0, max: 99999 },
            { key: "weight", label: "Вес, фнт", kind: "number", width: 5, min: 0, max: 99999, decimal: true },
            { key: "link", label: "Ссылка (https)", kind: "link" },
          ],
          weight: {
            weight: "weight",
            qty: "qty",
            // Подсказка без штрафов: что считать перегрузом, решает стол.
            capacity: { score: "abilities.str.score", factor: 15, label: "Сила × 15" },
          },
        },
        {
          kind: "fields",
          title: "Деньги",
          fields: [
            { key: "coins.pp", label: "пм", kind: "number", width: 5, min: 0, max: 9999999 },
            { key: "coins.gp", label: "зм", kind: "number", width: 5, min: 0, max: 9999999 },
            { key: "coins.ep", label: "эм", kind: "number", width: 5, min: 0, max: 9999999 },
            { key: "coins.sp", label: "см", kind: "number", width: 5, min: 0, max: 9999999 },
            { key: "coins.cp", label: "мм", kind: "number", width: 5, min: 0, max: 9999999 },
          ],
          // 1 пм = 10 зм, 1 эм = 1/2 зм, 1 см = 1/10 зм, 1 мм = 1/100 зм.
          total: {
            label: "всего в зм",
            unit: "зм",
            terms: [
              { key: "coins.pp", factor: 10 },
              { key: "coins.gp", factor: 1 },
              { key: "coins.ep", factor: 0.5 },
              { key: "coins.sp", factor: 0.1 },
              { key: "coins.cp", factor: 0.01 },
            ],
          },
        },
      ],
    },
    {
      id: "spells",
      title: "Заклинания",
      blocks: [
        {
          kind: "fields",
          title: "Ячейки заклинаний",
          fields: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
            key: `slots.${n}`,
            label: `${n} круг`,
            kind: "number" as const,
            width: 3,
            min: 0,
            max: 99,
          })),
        },
        {
          kind: "cards",
          title: "Заклинания",
          path: "spells",
          titleKey: "name",
          addLabel: "+ Заклинание",
          resourcesPath: "resources",
          fields: [
            { key: "level", label: "Круг", kind: "number", width: 3, min: 0, max: 9 },
            { key: "link", label: "Ссылка (https)", kind: "link" },
          ],
        },
      ],
    },
    {
      id: "features",
      title: "Умения",
      blocks: [
        {
          kind: "cards",
          title: "Умения и черты",
          path: "features",
          titleKey: "title",
          addLabel: "+ Умение",
          resourcesPath: "resources",
          fields: [],
        },
      ],
    },
    {
      id: "about",
      title: "О персонаже",
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
            {
              key: "info.size",
              label: "Размер",
              kind: "select",
              options: [
                { value: "", label: "-" },
                { value: "tiny", label: "Крошечный" },
                { value: "small", label: "Маленький" },
                { value: "medium", label: "Средний" },
                { value: "large", label: "Большой" },
                { value: "huge", label: "Огромный" },
                { value: "gargantuan", label: "Громадный" },
              ],
            },
          ],
        },
        {
          kind: "fields",
          title: "Внешность",
          fields: [
            { key: "info.age", label: "Возраст", kind: "text", width: 6 },
            { key: "info.height", label: "Рост", kind: "text", width: 6 },
            { key: "info.weight", label: "Вес", kind: "text", width: 6 },
            { key: "info.eyes", label: "Глаза", kind: "text", width: 12 },
            { key: "info.skin", label: "Кожа", kind: "text", width: 12 },
            { key: "info.hair", label: "Волосы", kind: "text", width: 12 },
          ],
        },
        {
          kind: "fields",
          title: "История и характер",
          // Свой текст игрока. Импорт LSS сюда не пишет - его тексты ниже
          // карточками, и переимпорт этих полей не трогает.
          fields: [
            { key: "about.story", label: "История персонажа", kind: "longtext" },
            { key: "about.appearance", label: "Внешность", kind: "longtext" },
            { key: "about.personality", label: "Черты характера", kind: "longtext" },
            { key: "about.ideals", label: "Идеалы", kind: "longtext" },
            { key: "about.bonds", label: "Привязанности", kind: "longtext" },
            { key: "about.flaws", label: "Слабости", kind: "longtext" },
          ],
        },
        {
          // Тексты LSS (предыстория, внешность, черты, союзники, задания,
          // заметки) - документы с форматированием, поэтому карточки.
          kind: "cards",
          title: "Записи",
          path: "lore",
          titleKey: "title",
          addLabel: "+ Запись",
          resourcesPath: "resources",
          fields: [],
        },
        {
          kind: "fields",
          title: "Заметки",
          fields: [{ key: "notes", label: "Заметки", kind: "longtext" }],
        },
      ],
    },
  ],
};

export const SHEETS: Record<string, SheetSchema> = { dnd5e, mob };
